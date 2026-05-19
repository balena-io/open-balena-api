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
		let deviceTypes = await api.resin.get({
			resource: 'device_type',
			passthrough: { req: permissions.rootRead },
			options: {
				$select: 'slug',
				...(ALLOWLISTED_DT_SLUGS.length > 0 && {
					$filter: {
						slug: { $in: ALLOWLISTED_DT_SLUGS },
					},
				}),
			},
		});

		if (deviceTypes.length > 0) {
			// This is an optimization to avoid multiple 404 queries for DTs that
			// have a DB record but do not have an OS release published yet.
			const s3DtSlugs = new Set(await listFolders(IMAGE_STORAGE_PREFIX));
			deviceTypes = deviceTypes.filter(({ slug }) => s3DtSlugs.has(slug));
		}

		await Promise.all(
			deviceTypes.map(async ({ slug }) => {
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

					if (latestDeviceTypeJson.aliases != null) {
						for (const alias of latestDeviceTypeJson.aliases) {
							result[alias] = result[slug];
						}
					}
				} catch (err) {
					captureException(
						err,
						`Failed to find a valid build for device type ${slug}`,
					);
				}
			}),
		);

		if (deviceTypes.length > 0 && Object.keys(result).length === 0) {
			throw new InternalRequestError('Could not retrieve any device type');
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
