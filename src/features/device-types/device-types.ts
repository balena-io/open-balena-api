import * as arraySort from 'array-sort';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';

import * as deviceTypesLib from '@resin.io/device-types';
import { sbvrUtils, errors } from '@balena/pinejs';
import * as semver from 'balena-semver';
import type { ODataOptions } from 'pinejs-client-core';
const { InternalRequestError } = errors;

import { captureException } from '../../infra/error-handling';

import {
	getCompressedSize,
	getDeviceTypeJson,
	getLogoUrl,
} from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';
import { withRetries } from '../../lib/utils';

const { BadRequestError, NotFoundError } = errors;
export type { NotFoundError };

export class UnknownDeviceTypeError extends NotFoundError {
	constructor(slug: string) {
		super(`Unknown device type ${slug}`);
	}
}

export class UnknownVersionError extends NotFoundError {
	constructor(slug: string, buildId: string) {
		super(`Device ${slug} not found for ${buildId} version`);
	}
}

export type DeviceType = deviceTypesLib.DeviceType;

interface DeviceTypeInfo {
	latest: DeviceType;
	versions: string[];
}

const SPECIAL_SLUGS = ['edge'];
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
): Promise<DeviceType | undefined> => {
	for (const buildId of versions) {
		let deviceType: DeviceType | undefined;
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

let getOsVersionsByDeviceType: (
	deviceTypeSlugs: string[],
) => Promise<Dictionary<string[]>> = async (deviceTypeSlugs: string[]) => {
	const results: Dictionary<string[]> = {};
	await Promise.all(
		deviceTypeSlugs.map(async (slug) => {
			try {
				results[slug] = await listFolders(getImageKey(slug));
			} catch (err) {
				captureException(
					err,
					`Error while retrieving build for device type ${slug}`,
				);
			}
		}),
	);
	return results;
};

export const setOsVersionsProvider = (
	provider: typeof getOsVersionsByDeviceType,
) => {
	getOsVersionsByDeviceType = provider;
};

async function fetchDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	const result: Dictionary<DeviceTypeInfo> = {};
	// TODO: Do we really need this clear?
	getDeviceTypeJson.clear();
	const slugs = await listFolders(IMAGE_STORAGE_PREFIX);
	const osVersionsBySlug = await getOsVersionsByDeviceType(slugs);
	await Promise.all(
		Object.entries(osVersionsBySlug).map(async ([slug, versions]) => {
			try {
				if (!versions.length) {
					return;
				}

				const sortedBuilds = sortBuildIds(versions);
				const latestDeviceType = await getFirstValidBuild(slug, sortedBuilds);
				if (!latestDeviceType) {
					return;
				}

				result[slug] = {
					versions: sortedBuilds,
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
		await Bluebird.delay(DEVICE_TYPES_CACHE_EXPIRATION);
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

async function getDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	// Always return the local cache if populated
	return await (deviceTypesCache ?? fetchDeviceTypesAndReschedule());
}

/**
 * Performs access controls for slugs against the database
 * @param resinApi The pinejs client
 * @param slugs The slugs to check, these cannot be aliases.
 */
const getAccessibleSlugs = async (
	resinApi: sbvrUtils.PinejsClient,
	slugs?: string[],
): Promise<string[]> => {
	const options: ODataOptions = {
		$select: ['slug'],
	};
	if (slugs) {
		options['$filter'] = {
			slug: { $in: slugs },
		};
	}
	const accessibleDeviceTypes = (await resinApi.get({
		resource: 'device_type',
		options,
	})) as Array<{ slug: string }>;
	return _.map(accessibleDeviceTypes, 'slug');
};

const findDeviceTypeInfoBySlug = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<DeviceTypeInfo> => {
	const deviceTypeInfos = await getDeviceTypes();
	// the slug can be an alias,
	// since the Dictionary also has props for the aliases
	const deviceTypeInfo = deviceTypeInfos[slug];
	if (!deviceTypeInfo || !deviceTypeInfo.latest) {
		throw new UnknownDeviceTypeError(slug);
	}

	const [accessibleSlug] = await getAccessibleSlugs(resinApi, [
		deviceTypeInfo.latest.slug,
	]);
	if (accessibleSlug !== deviceTypeInfo.latest.slug) {
		// We cannot access the device type
		throw new UnknownDeviceTypeError(slug);
	}
	return deviceTypeInfo;
};

export const validateSlug = (slug?: string) => {
	if (slug == null || !/^[\w-]+$/.test(slug)) {
		throw new BadRequestError('Invalid device type');
	}
	return slug;
};

const getAllDeviceTypes = async () => {
	const dtInfo = await getDeviceTypes();
	return _.uniqBy(
		Object.values(dtInfo).map((dtEntry) => dtEntry.latest),
		(dt) => dt.slug,
	);
};

export const getAccessibleDeviceTypes = async (
	resinApi: sbvrUtils.PinejsClient,
): Promise<DeviceType[]> => {
	const [deviceTypes, accessibleDeviceTypes] = await Promise.all([
		getAllDeviceTypes(),
		getAccessibleSlugs(resinApi),
	]);

	const accessSet = new Set(accessibleDeviceTypes);
	return deviceTypes.filter((deviceType) => {
		return accessSet.has(deviceType.slug);
	});
};

export const findBySlug = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<DeviceType> => {
	const deviceTypes = await getAccessibleDeviceTypes(resinApi);
	const deviceType = await deviceTypesLib.findBySlug(deviceTypes, slug);
	if (deviceType == null) {
		throw new UnknownDeviceTypeError(slug);
	}
	return deviceType;
};

const normalizeDeviceType = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<string> => {
	if (SPECIAL_SLUGS.includes(slug)) {
		return slug;
	}

	const deviceTypes = await getAccessibleDeviceTypes(resinApi);
	const normalizedSlug = await deviceTypesLib.normalizeDeviceType(
		deviceTypes,
		slug,
	);
	if (normalizedSlug == null) {
		throw new UnknownDeviceTypeError(slug);
	}
	return normalizedSlug;
};

export const getImageSize = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
	buildId: string,
): Promise<number> => {
	const deviceTypeInfo = await findDeviceTypeInfoBySlug(resinApi, slug);
	const deviceType = deviceTypeInfo.latest;
	const normalizedSlug = deviceType.slug;

	if (buildId === 'latest') {
		buildId = deviceType.buildId;
	}

	if (!deviceTypeInfo.versions.includes(buildId)) {
		throw new UnknownVersionError(slug, buildId);
	}

	const hasDeviceTypeJson = await getDeviceTypeJson(normalizedSlug, buildId);

	if (!hasDeviceTypeJson) {
		throw new UnknownVersionError(slug, buildId);
	}

	try {
		return await getCompressedSize(normalizedSlug, buildId);
	} catch (err) {
		captureException(
			err,
			`Failed to get device type ${slug} compressed size for version ${buildId}`,
		);
		throw err;
	}
};

export interface ImageVersions {
	versions: string[];
	latest: string;
}

export const getDeviceTypeIdBySlug = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<{ id: number; slug: string } | undefined> => {
	const deviceType = await normalizeDeviceType(resinApi, slug);

	const dt = (await resinApi.get({
		resource: 'device_type',
		id: {
			slug: deviceType,
		},
		options: {
			$select: ['id', 'slug'],
		},
	})) as { id: number; slug: string } | undefined;

	return dt;
};

export const getImageVersions = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<ImageVersions> => {
	const deviceTypeInfo = await findDeviceTypeInfoBySlug(resinApi, slug);
	const deviceType = deviceTypeInfo.latest;
	const normalizedSlug = deviceType.slug;

	const versionInfo = await Promise.all(
		deviceTypeInfo.versions.map(async (buildId) => {
			try {
				return {
					buildId,
					hasDeviceTypeJson: await getDeviceTypeJson(normalizedSlug, buildId),
				};
			} catch {
				return;
			}
		}),
	);
	const filteredInfo = versionInfo.filter(
		(buildInfo): buildInfo is NonNullable<typeof buildInfo> =>
			buildInfo != null && !!buildInfo.hasDeviceTypeJson,
	);
	if (_.isEmpty(filteredInfo) && !_.isEmpty(deviceTypeInfo.versions)) {
		throw new InternalRequestError(
			`Could not retrieve any image version for device type ${slug}`,
		);
	}

	const buildIds = filteredInfo.map(({ buildId }) => buildId);
	return {
		versions: buildIds,
		latest: buildIds[0],
	};
};
