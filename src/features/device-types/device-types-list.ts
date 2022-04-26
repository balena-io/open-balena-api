import * as arraySort from 'array-sort';
import * as _ from 'lodash';

import type { DeviceTypeJson } from './device-type-json';
import { errors } from '@balena/pinejs';
import * as semver from 'balena-semver';
const { InternalRequestError } = errors;

import { captureException } from '../../infra/error-handling';

import { getDeviceTypeJson, getLogoUrl } from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';
import { withRetries } from '../../lib/utils';
import { setTimeout } from 'timers/promises';

export interface DeviceTypeInfo {
	latest: DeviceTypeJson;
	versions: string[];
}

const DEVICE_TYPES_CACHE_EXPIRATION = 5 * 60 * 1000; // 5 mins

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

async function fetchDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	const result: Dictionary<DeviceTypeInfo> = {};
	const slugs = await listFolders(IMAGE_STORAGE_PREFIX);
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
}

let deviceTypesCache:
	| Promise<Dictionary<DeviceTypeInfo>>
	| Dictionary<DeviceTypeInfo>
	| undefined;

async function scheduleFetchDeviceTypes() {
	try {
		await setTimeout(DEVICE_TYPES_CACHE_EXPIRATION);
		await fetchDeviceTypesAndReschedule();
	} catch (err) {
		captureException(err, 'Failed to re-fetch device types');
	}
}

async function fetchDeviceTypesAndReschedule(): Promise<
	Dictionary<DeviceTypeInfo>
> {
	try {
		const promise = withRetries(fetchDeviceTypes);

		// if the cache is still empty, use this promise so that
		// we do not start a second set of requests to s3
		// in case another api request comes before the first completes
		if (!deviceTypesCache) {
			deviceTypesCache = promise;
		}

		try {
			deviceTypesCache = await promise;
			return deviceTypesCache;
		} catch (err) {
			if (deviceTypesCache === promise) {
				deviceTypesCache = undefined;
			}
			captureException(err, 'Failed to get device types');
			throw err;
		}
	} finally {
		// schedule a re-run to update the local cache - do not wait for it
		scheduleFetchDeviceTypes();
	}
}

export async function getDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	// Always return the local cache if populated
	return await (deviceTypesCache ?? fetchDeviceTypesAndReschedule());
}
