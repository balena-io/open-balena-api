import * as arraySort from 'array-sort';
import * as _ from 'lodash';

import type { DeviceTypeJson } from './device-type-json';
import { sbvrUtils, errors } from '@balena/pinejs';
import * as semver from 'balena-semver';
const { InternalRequestError } = errors;

import { captureException } from '../../infra/error-handling';

import {
	getCompressedSize,
	getDeviceTypeJson,
	getLogoUrl,
} from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';
import { withRetries } from '../../lib/utils';
import { setTimeout } from 'timers/promises';

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

interface DeviceTypeInfo {
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

async function getDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	// Always return the local cache if populated
	return await (deviceTypesCache ?? fetchDeviceTypesAndReschedule());
}

/**
 * Resolves a device type by slug or alias & performs access control for DTs against the database.
 * @param resinApi The pinejs client
 * @param slug The slug or alias to check.
 */
export const getDeviceTypeBySlug = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<{ id: number; slug: string }> => {
	const [dt] = (await resinApi.get({
		resource: 'device_type',
		options: {
			$top: 1,
			$select: ['id', 'slug'],
			$filter: {
				device_type_alias: {
					$any: {
						$alias: 'dta',
						$expr: {
							dta: {
								is_referenced_by__alias: slug,
							},
						},
					},
				},
			},
		},
	})) as [{ id: number; slug: string }] | [];

	if (dt == null) {
		throw new UnknownDeviceTypeError(slug);
	}

	return dt;
};

const findDeviceTypeInfoBySlug = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<DeviceTypeInfo> => {
	const deviceTypeResource = await getDeviceTypeBySlug(resinApi, slug);
	const deviceTypeInfos = await getDeviceTypes();
	const deviceTypeInfo = deviceTypeInfos[deviceTypeResource.slug];
	if (deviceTypeInfo?.latest == null) {
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

/** @deprecated */
const getAllDeviceTypes = async () => {
	const dtInfo = await getDeviceTypes();
	return _.uniqBy(
		Object.values(dtInfo).map((dtEntry) => dtEntry.latest),
		(dt) => dt.slug,
	);
};

/** @deprecated */
export const getAccessibleDeviceTypes = async (
	resinApi: sbvrUtils.PinejsClient,
): Promise<DeviceTypeJson[]> => {
	const [deviceTypes, accessibleDeviceTypes] = await Promise.all([
		getAllDeviceTypes(),
		resinApi.get({
			resource: 'device_type',
			options: {
				$select: 'slug',
			},
		}) as Promise<Array<{ slug: string }>>,
	]);

	const accessSet = new Set(accessibleDeviceTypes.map((dt) => dt.slug));
	return deviceTypes.filter((deviceType) => {
		return accessSet.has(deviceType.slug);
	});
};

/** @deprecated Use the getDeviceTypeBySlug unless you need the device-type.json contents. */
export const findBySlug = async (
	resinApi: sbvrUtils.PinejsClient,
	slug: string,
): Promise<DeviceTypeJson> =>
	(await findDeviceTypeInfoBySlug(resinApi, slug)).latest;

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
