import type { DeviceTypeJson } from './device-type-json.js';
import { errors, permissions, sbvrUtils } from '@balena/pinejs';
import * as semver from 'balena-semver';
const { InternalRequestError } = errors;

import { captureException } from '../../infra/error-handling/index.js';

import { getDeviceTypeJson, getLogoUrl } from './build-info-facade.js';
import {
	getImageKey,
	IMAGE_STORAGE_PREFIX,
	listFolders,
} from './storage/index.js';
import { multiCacheMemoizee } from '../../infra/cache/index.js';
import {
	DEVICE_TYPES_CACHE_LOCAL_TIMEOUT,
	DEVICE_TYPES_CACHE_TIMEOUT,
	CONTRACT_ALLOWLIST,
	IMAGE_STORAGE_DEBUG_REQUEST_ERRORS,
} from '../../lib/config.js';
import { ESR_MIN_MAJOR } from './device-types.js';

const { api } = sbvrUtils;

function sortBuildIds(ids: string[]): string[] {
	return ids.sort((a, b) => {
		return (
			// First sort prerelease versions to the end
			(semver.prerelease(a) ? 1 : 0) - (semver.prerelease(b) ? 1 : 0) ||
			// And if neither are prerelease, sort them by descending semver
			semver.rcompare(a, b)
		);
	});
}

const getFirstValidBuild = async (
	slug: string,
	versions: string[],
): Promise<DeviceTypeJson | undefined> => {
	for (const buildId of versions) {
		let deviceType: DeviceTypeJson | undefined;
		try {
			deviceType = await getDeviceTypeJson(slug, buildId);
		} catch (err) {
			if (IMAGE_STORAGE_DEBUG_REQUEST_ERRORS) {
				captureException(
					err,
					`Failed to get device type build data for ${slug}/${buildId}`,
				);
			}
		}
		if (deviceType) {
			const logoUrl = await getLogoUrl(slug, buildId);
			if (logoUrl) {
				deviceType.logoUrl = logoUrl;
			}
			return deviceType;
		}
	}
};

const getDeviceTypeJsonFromAsset = async (
	href: string,
): Promise<DeviceTypeJson> => {
	const response = await fetch(href);
	if (!response.ok) {
		throw new InternalRequestError(
			'Failed to retrieve device type json from release asset',
		);
	}
	return (await response.json()) as DeviceTypeJson;
};

const ALLOWLISTED_DT_SLUGS: string[] = [];
for (const contractPath of CONTRACT_ALLOWLIST) {
	const allowListedDtSlug = /^hw.device-type\/([\w-]+)$/.exec(
		contractPath,
	)?.[1];
	if (allowListedDtSlug != null) {
		ALLOWLISTED_DT_SLUGS.push(allowListedDtSlug);
	}
}

export const getDeviceTypeJsons = multiCacheMemoizee(
	async (): Promise<Dictionary<DeviceTypeJson>> => {
		const result: Dictionary<DeviceTypeJson> = {};
		const deviceTypes = await api.resin.get({
			resource: 'device_type',
			passthrough: { req: permissions.rootRead },
			options: {
				$select: 'slug',
				$expand: {
					is_default_for__application: {
						$top: 2,
						$select: ['id'],
						$expand: {
							// TODO: this could possibly use should_be_running__release
							// to simplify the filter/orderby semantics
							owns__release: {
								$top: 1,
								$select: ['id', 'raw_version'],
								$expand: {
									release_asset: {
										$select: ['asset_key', 'asset'],
										$filter: {
											asset_key: 'device-type.json',
										},
									},
								},
								$filter: {
									status: 'success',
									is_final: true,
									is_invalidated: false,
									$and: [
										{ semver_major: { $lt: ESR_MIN_MAJOR } },
										{ semver_major: { $gt: 0 } },
									],
								},
								$orderby: [
									{ semver_major: 'desc' },
									{ semver_minor: 'desc' },
									{ semver_patch: 'desc' },
									{ revision: 'desc' },
									// prefer prod over dev
									{ variant: 'desc' },
									{ created_at: 'desc' },
								],
							},
						},
						$filter: {
							is_host: true,
							$not: {
								application_tag: {
									$any: {
										$alias: 'at',
										$expr: {
											at: { tag_key: 'release-policy' },
										},
									},
								},
							},
						},
					},
				},
				...(ALLOWLISTED_DT_SLUGS.length > 0 && {
					$filter: {
						slug: { $in: ALLOWLISTED_DT_SLUGS },
					},
				}),
			},
		});

		const dtsWithAssetRelease = deviceTypes.map((dt) => {
			const hostApps = dt.is_default_for__application;
			if (hostApps.length > 1) {
				const message = `Found ${hostApps.length} host applications for device type ${dt.slug}, expected at most 1`;
				captureException(new Error(message), message, {
					tags: { slug: dt.slug },
					extra: { hostAppIds: hostApps.map((app) => app.id) },
				});
			}
			const assetRelease = hostApps
				.flatMap((app) => app.owns__release)
				.find((rel) => rel?.release_asset[0]?.asset != null);
			return { dt, assetRelease };
		});

		const dtsWithAssets = dtsWithAssetRelease.flatMap(({ dt, assetRelease }) =>
			assetRelease != null ? [{ slug: dt.slug, assetRelease }] : [],
		);
		let dtsWithoutAssets = dtsWithAssetRelease.flatMap(
			({ dt, assetRelease }) => (assetRelease == null ? [dt] : []),
		);

		if (dtsWithoutAssets.length > 0) {
			// This is an optimization to avoid multiple 404 queries for DTs that
			// have a DB record but do not have an OS release published yet.
			const s3DtSlugs = new Set(await listFolders(IMAGE_STORAGE_PREFIX));
			dtsWithoutAssets = dtsWithoutAssets.filter(({ slug }) =>
				s3DtSlugs.has(slug),
			);
		}

		await Promise.all([
			...dtsWithAssets.map(async ({ slug, assetRelease }) => {
				try {
					const deviceTypeJson = await getDeviceTypeJsonFromAsset(
						assetRelease.release_asset[0].asset!.href,
					);
					// TODO: we can possibly drop this field in the next major
					deviceTypeJson.buildId = assetRelease.raw_version;
					result[slug] = deviceTypeJson;
				} catch (err) {
					captureException(
						err,
						`Failed to find a valid hostApp release with assets for device type ${slug}`,
					);
				}
			}),
			...dtsWithoutAssets.map(async ({ slug }) => {
				try {
					const builds = await listFolders(getImageKey(slug));
					if (builds.length === 0) {
						return;
					}

					const sortedBuilds = sortBuildIds(builds);
					const latestDeviceTypeJson = await getFirstValidBuild(
						slug,
						sortedBuilds,
					);
					if (!latestDeviceTypeJson) {
						return;
					}
					result[slug] = latestDeviceTypeJson;
				} catch (err) {
					captureException(
						err,
						`Failed to find a valid build for device type ${slug}`,
					);
				}
			}),
		]);

		if (deviceTypes.length > 0 && Object.keys(result).length === 0) {
			throw new InternalRequestError('Could not retrieve any device type');
		}

		for (const [slug, dtJson] of Object.entries(result)) {
			if (dtJson.aliases != null) {
				for (const alias of dtJson.aliases) {
					result[alias] = result[slug];
				}
			}
		}
		return result;
	},
	{
		cacheKey: 'getDeviceTypeJsons',
		promise: true,
		primitive: true,
		maxAge: DEVICE_TYPES_CACHE_LOCAL_TIMEOUT,
	},
	{
		global: {
			preFetch: 0.1,
			maxAge: DEVICE_TYPES_CACHE_TIMEOUT,
		},
		useVersion: false,
	},
);
