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

const { api } = sbvrUtils;

export interface DeviceTypeInfo {
	latest: DeviceTypeJson;
	versions: string[];
}

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

const getDeviceTypeJsonFromAsset = async (
	href: string,
): Promise<DeviceTypeJson | undefined> => {
	const response = await fetch(href);
	if (!response.ok) {
		return undefined;
	}
	return (await response.json()) as DeviceTypeJson;
};

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

const ALLOWLISTED_DT_SLUGS: string[] = [];
for (const contractPath of CONTRACT_ALLOWLIST) {
	const allowListedDtSlug = /^hw.device-type\/([\w-]+)$/.exec(
		contractPath,
	)?.[1];
	if (allowListedDtSlug != null) {
		ALLOWLISTED_DT_SLUGS.push(allowListedDtSlug);
	}
}

export const getDeviceTypes = multiCacheMemoizee(
	async (): Promise<Dictionary<DeviceTypeInfo>> => {
		const result: Dictionary<DeviceTypeInfo> = {};
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
									semver_major: { $gt: 0 },
								},
								$orderby: [
									{ semver_major: 'desc' },
									{ semver_minor: 'desc' },
									{ semver_patch: 'desc' },
									{ revision: 'desc' },
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

		const dtsWithReleaseAssets: Array<{
			slug: string;
			appWithAsset: (typeof deviceTypes)[number]['is_default_for__application'][number];
		}> = [];
		let dtsWithoutReleaseAssets: Array<{ slug: string }> = [];

		for (const { slug, is_default_for__application: hostApps } of deviceTypes) {
			if (hostApps.length > 1) {
				const message = `Found ${hostApps.length} host applications for device type ${slug}, expected at most 1`;
				console.warn(message);
				captureException(new Error(message), message, {
					tags: { slug },
					extra: { hostAppIds: hostApps.map((app) => app.id) },
				});
			}

			const appWithAsset = hostApps.find(
				(app) => app.owns__release[0]?.release_asset[0]?.asset != null,
			);
			if (appWithAsset != null) {
				dtsWithReleaseAssets.push({ slug, appWithAsset });
			} else {
				dtsWithoutReleaseAssets.push({ slug });
			}
		}

		if (dtsWithoutReleaseAssets.length > 0) {
			// This is an optimization to avoid multiple 404 queries for DTs that
			// have a DB record but do not have an OS release published yet.
			const s3DtSlugs = new Set(await listFolders(IMAGE_STORAGE_PREFIX));
			dtsWithoutReleaseAssets = dtsWithoutReleaseAssets.filter(({ slug }) =>
				s3DtSlugs.has(slug),
			);
		}

		const setResult = (slug: string, info: DeviceTypeInfo) => {
			result[slug] = info;
			if (info.latest.aliases != null) {
				for (const alias of info.latest.aliases) {
					result[alias] = info;
				}
			}
		};

		await Promise.all([
			...dtsWithReleaseAssets.map(async ({ slug, appWithAsset }) => {
				try {
					const release = appWithAsset.owns__release[0];
					const asset = release.release_asset[0].asset!;
					const deviceTypeJson = await getDeviceTypeJsonFromAsset(asset.href);
					if (deviceTypeJson == null) {
						return;
					}
					deviceTypeJson.buildId = release.raw_version;
					setResult(slug, {
						versions: [release.raw_version],
						latest: deviceTypeJson,
					});
				} catch (err) {
					captureException(
						err,
						`Failed to find a valid build for device type ${slug}`,
					);
				}
			}),
			...dtsWithoutReleaseAssets.map(async ({ slug }) => {
				try {
					const builds = await listFolders(getImageKey(slug));
					if (builds.length === 0) {
						return;
					}
					const sortedBuilds = sortBuildIds(builds);
					const latestDeviceType = await getFirstValidBuild(slug, sortedBuilds);
					if (!latestDeviceType) {
						return;
					}
					setResult(slug, {
						versions: builds,
						latest: latestDeviceType,
					});
				} catch (err) {
					captureException(
						err,
						`Failed to find a valid build for device type ${slug}`,
					);
				}
			}),
		]);

		if (
			dtsWithReleaseAssets.length + dtsWithoutReleaseAssets.length > 0 &&
			Object.keys(result).length === 0
		) {
			throw new InternalRequestError('Could not retrieve any device type');
		}
		return result;
	},
	{
		cacheKey: 'fetchDeviceTypes',
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
