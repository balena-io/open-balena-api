import arraySort from 'array-sort';
import _ from 'lodash';

import type { DeviceTypeJson } from './device-type-json';
import { errors } from '@balena/pinejs';
import * as semver from 'balena-semver';
const { InternalRequestError } = errors;

import { captureException } from '../../infra/error-handling';

import { getDeviceTypeJson, getLogoUrl } from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';
import { multiCacheMemoizee } from '../../infra/cache';
import {
	DEVICE_TYPES_CACHE_LOCAL_TIMEOUT,
	DEVICE_TYPES_CACHE_TIMEOUT,
	CONTRACT_ALLOWLIST,
} from '../../lib/config';

export interface DeviceTypeInfo {
	latest: DeviceTypeJson;
	versions: string[];
}

function sortBuildIds(ids: string[]): string[] {
	return arraySort(
		ids,
		(a: string, b: string) => {
			return (semver.prerelease(a) ? 1 : 0) - (semver.prerelease(b) ? 1 : 0);
		},
		semver.rcompare,
	);
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
			captureException(
				err,
				`Failed to get device type build data for ${slug}/${buildId}`,
			);
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

export const getDeviceTypes = multiCacheMemoizee(
	async (): Promise<Dictionary<DeviceTypeInfo>> => {
		const result: Dictionary<DeviceTypeInfo> = {};
		let slugs = await listFolders(IMAGE_STORAGE_PREFIX);

		// If there are explicit includes, then everything else is excluded so we need to
		// filter the slugs list to include only contracts that are in the CONTRACT_ALLOWLIST map
		if (CONTRACT_ALLOWLIST.size > 0) {
			const before = slugs.length;
			slugs = slugs.filter((slug) =>
				CONTRACT_ALLOWLIST.has(`hw.device-type/${slug}`),
			);
			console.log(
				`CONTRACT_ALLOWLIST reduced device type slugs from ${before} to ${slugs.length}`,
			);
		}

		await Promise.all(
			slugs.map(async (slug) => {
				try {
					const builds = await listFolders(getImageKey(slug));
					if (_.isEmpty(builds)) {
						return;
					}

					const sortedBuilds = sortBuildIds(builds);
					const latestDeviceType = await getFirstValidBuild(slug, sortedBuilds);
					if (!latestDeviceType) {
						return;
					}

					result[slug] = {
						versions: builds,
						latest: latestDeviceType,
					};

					_.forEach(latestDeviceType.aliases, (alias) => {
						result[alias] = result[slug];
					});
				} catch (err) {
					captureException(
						err,
						`Failed to find a valid build for device type ${slug}`,
					);
				}
			}),
		);

		if (_.isEmpty(result) && !_.isEmpty(slugs)) {
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
		preFetch: 0.1,
		maxAge: DEVICE_TYPES_CACHE_TIMEOUT,
	},
);
