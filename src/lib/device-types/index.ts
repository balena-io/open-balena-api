import * as deviceTypesLib from '@resin.io/device-types';
import { sbvrUtils } from '@resin/pinejs';
import * as arraySort from 'array-sort';
import * as semver from 'balena-semver';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import { PinejsClientCoreFactory } from 'pinejs-client-core';
import { PinejsClient, Tx } from '../../platform';
import { captureException } from '../../platform/errors';
import {
	getCompressedSize,
	getDeviceTypeJson,
	getIsIgnored,
	getLogoUrl,
} from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';

const { InternalRequestError, root, api } = sbvrUtils;
export const { BadRequestError, NotFoundError } = sbvrUtils;

export type DeviceType = deviceTypesLib.DeviceType;

export class InvalidDeviceTypeError extends BadRequestError {}

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

interface BuildInfo {
	ignored: boolean;
	deviceType: DeviceType;
}

interface DeviceTypeInfo {
	latest: BuildInfo;
	versions: string[];
}

const SPECIAL_SLUGS = ['edge'];
const RETRY_DELAY = 2000; // ms
const DEVICE_TYPES_CACHE_EXPIRATION = 5 * 60 * 1000; // 5 mins

/**
 * This map will hold information on which device type fields
 * imported from the device type registry will be synced to which db fields.
 * the key of dictionary is the field in the database.
 * the name of a dictionary entry is the field in the dt json
 * the default of a dictionary entry is a default value if the field in dt json does not exist
 */
const syncSettings = {
	map: {} as Dictionary<{
		name: string;
		default?: any;
	}>,
};

export function setSyncMap(map: typeof syncSettings['map']) {
	syncSettings.map = map;
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

const getBuildData = (slug: string, buildId: string): Promise<BuildInfo> => {
	return Bluebird.join(
		getIsIgnored(slug, buildId),
		getDeviceTypeJson(slug, buildId).catch(() => undefined),
		(ignored, deviceType) => {
			const buildInfo = {
				ignored,
				deviceType,
			};

			return buildInfo;
		},
	);
};

const getFirstValidBuild = async (
	slug: string,
	versions: string[],
): Promise<BuildInfo | undefined> => {
	if (_.isEmpty(versions)) {
		return;
	}

	const buildId = versions[0];
	let buildInfo: BuildInfo | undefined;
	try {
		buildInfo = await getBuildData(slug, buildId);
	} catch (err) {
		captureException(
			err,
			`Failed to get device type build data for ${slug}/${buildId}`,
		);
	}
	if (buildInfo && !buildInfo.ignored && buildInfo.deviceType) {
		const logoUrl = await getLogoUrl(slug, buildId);
		if (logoUrl) {
			buildInfo.deviceType.logoUrl = logoUrl;
		}
		return buildInfo;
	}

	return getFirstValidBuild(slug, _.tail(versions));
};

async function fetchDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	const result: Dictionary<DeviceTypeInfo> = {};
	getIsIgnored.clear();
	getDeviceTypeJson.clear();
	try {
		const slugs = await listFolders(IMAGE_STORAGE_PREFIX);
		await Bluebird.map(slugs, async (slug) => {
			try {
				const builds = await listFolders(getImageKey(slug));
				if (_.isEmpty(builds)) {
					return;
				}

				const sortedBuilds = sortBuildIds(builds);
				const latestBuildInfo = await getFirstValidBuild(slug, sortedBuilds);
				if (!latestBuildInfo) {
					return;
				}

				result[slug] = {
					versions: builds,
					latest: latestBuildInfo,
				};

				_.forEach(latestBuildInfo.deviceType.aliases, (alias) => {
					result[alias] = result[slug];
				});
			} catch (err) {
				captureException(
					err,
					`Failed to find a valid build for device type ${slug}`,
				);
			}
		});

		if (_.isEmpty(result) && !_.isEmpty(slugs)) {
			throw new InternalRequestError('Could not retrieve any device type');
		}
		return result;
	} catch (err) {
		captureException(err, 'Failed to get device types');
		await Bluebird.delay(RETRY_DELAY);
		return fetchDeviceTypes();
	}
}

async function updateDTModel(
	deviceType: deviceTypesLib.DeviceType,
	propertyMap: typeof syncSettings['map'],
	tx: Tx,
): Promise<void> {
	const apiTx = api.resin.clone({ passthrough: { req: root, tx } });
	const updateFields = _.mapValues(
		propertyMap,
		(source) => (deviceType as AnyObject)[source.name] || source.default,
	);
	const updateFilter = _.map(
		propertyMap,
		(value, key): PinejsClientCoreFactory.Filter => {
			return {
				[key]: {
					$ne: (deviceType as AnyObject)[value.name] || value.default,
				},
			};
		},
	);
	const results = (await apiTx.get({
		resource: 'device_type',
		options: {
			$filter: {
				slug: deviceType.slug,
			},
			$select: ['id'],
		},
	})) as AnyObject[];
	if (results.length === 0) {
		const body = {
			slug: deviceType.slug,
			...updateFields,
		};
		await apiTx.post({
			resource: 'device_type',
			body,
			options: { returnResource: false },
		});
		return;
	} else if (results.length > 1) {
		throw new Error(
			`updateOrInsert filter not unique for 'device_type': '${JSON.stringify({
				slug: deviceType.slug,
			})}'`,
		);
	} else {
		let filter: AnyObject = {
			id: results[0].id,
		};
		if (updateFilter.length > 1) {
			filter['$or'] = updateFilter;
		} else if (updateFilter.length === 1) {
			filter = _.merge(filter, updateFilter[0]);
		}
		// do a patch with the id
		await apiTx.patch({
			resource: 'device_type',
			id: results[0].id,
			body: updateFields,
			options: {
				$filter: filter,
			},
		});
		return;
	}
}

function syncDataModel(
	types: Dictionary<DeviceTypeInfo>,
	propertyMap: typeof syncSettings['map'],
) {
	if (_.isEmpty(propertyMap)) {
		captureException(
			new Error('No properties to sync into the device type model'),
		);
		return;
	}
	return sbvrUtils.db.transaction(async (tx) => {
		await Promise.all(
			_(types)
				.map(({ latest }) => latest.deviceType)
				// This keyBy removes duplicates for the same slug, ie due to aliases
				.keyBy(({ slug }) => slug)
				.map((deviceType) => updateDTModel(deviceType, propertyMap, tx))
				.value(),
		);
	});
}

let deviceTypesCache: Promise<Dictionary<DeviceTypeInfo>> | undefined;

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
		const promise = fetchDeviceTypes().then(async (deviceTypeInfo) => {
			await syncDataModel(deviceTypeInfo, syncSettings.map);

			// when the promise gets resolved, cache it
			deviceTypesCache = promise;

			return deviceTypeInfo;
		});

		// if the cache is still empty, use this promise so that
		// we do not start a second set of requests to s3
		// in case another api request comes before the first completes
		if (!deviceTypesCache) {
			deviceTypesCache = promise;
		}
		return promise;
	} finally {
		// schedule a re-run to update the local cache - do not wait for it
		scheduleFetchDeviceTypes();
	}
}

function getDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	// Always return the local cache if populated
	return deviceTypesCache ?? fetchDeviceTypesAndReschedule();
}

/**
 * Performs access controls for slugs against the database
 * @param resinApi The pinejs client
 * @param slugs The slugs to check, these cannot be aliases.
 */
const getAccessibleSlugs = async (
	resinApi: PinejsClient,
	slugs?: string[],
): Promise<string[]> => {
	const options: PinejsClientCoreFactory.ODataOptions = {
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

export const findDeviceTypeInfoBySlug = async (
	resinApi: PinejsClient,
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
		deviceTypeInfo.latest.deviceType.slug,
	]);
	if (accessibleSlug !== deviceTypeInfo.latest.deviceType.slug) {
		// We cannot access the device type
		throw new UnknownDeviceTypeError(slug);
	}
	return deviceTypeInfo;
};

export const validateSlug = (slug?: string) => {
	if (slug == null || !/^[\w-]+$/.test(slug)) {
		throw new InvalidDeviceTypeError('Invalid device type');
	}
	return slug;
};

export const getAccessibleDeviceTypes = async (
	resinApi: PinejsClient,
): Promise<DeviceType[]> => {
	const [deviceTypesInfos, accessibleDeviceTypes] = await Promise.all([
		getDeviceTypes(),
		getAccessibleSlugs(resinApi),
	]);

	const accessSet = new Set(accessibleDeviceTypes);
	const deviceTypes = _(deviceTypesInfos)
		.filter((deviceTypesInfo: DeviceTypeInfo, slug: string) => {
			const dtSlug = deviceTypesInfo.latest.deviceType.slug;
			return dtSlug === slug && accessSet.has(dtSlug);
		})
		.map((deviceTypesInfo) => deviceTypesInfo.latest.deviceType)
		.value();
	return deviceTypes;
};

export const findBySlug = async (
	resinApi: PinejsClient,
	slug: string,
): Promise<DeviceType> => {
	const deviceTypes = await getAccessibleDeviceTypes(resinApi);
	const deviceType = await deviceTypesLib.findBySlug(deviceTypes, slug);
	if (deviceType == null) {
		throw new UnknownDeviceTypeError(slug);
	}
	return deviceType;
};

export const normalizeDeviceType = async (
	resinApi: PinejsClient,
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
	resinApi: PinejsClient,
	slug: string,
	buildId: string,
): Promise<number> => {
	const deviceTypeInfo = await findDeviceTypeInfoBySlug(resinApi, slug);
	const deviceType = deviceTypeInfo.latest.deviceType;
	const normalizedSlug = deviceType.slug;

	if (buildId === 'latest') {
		buildId = deviceType.buildId;
	}

	if (!deviceTypeInfo.versions.includes(buildId)) {
		throw new UnknownVersionError(slug, buildId);
	}

	const [ignored, hasDeviceTypeJson] = await Promise.all([
		getIsIgnored(normalizedSlug, buildId),
		getDeviceTypeJson(normalizedSlug, buildId),
	]);

	if (ignored || !hasDeviceTypeJson) {
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
	resinApi: PinejsClient,
	slug: string,
): Promise<{ id: number; slug: string }> => {
	const deviceType = await normalizeDeviceType(resinApi, slug);

	const [dt] = (await resinApi.get({
		resource: 'device_type',
		options: {
			$select: ['id', 'slug'],
			$filter: {
				slug: deviceType,
			},
		},
	})) as Array<{ id: number; slug: string }>;

	return dt;
};

export const getImageVersions = async (
	resinApi: PinejsClient,
	slug: string,
): Promise<ImageVersions> => {
	const deviceTypeInfo = await findDeviceTypeInfoBySlug(resinApi, slug);
	const deviceType = deviceTypeInfo.latest.deviceType;
	const normalizedSlug = deviceType.slug;

	const versionInfo = await Bluebird.map(
		deviceTypeInfo.versions,
		async (buildId) => {
			try {
				return await Bluebird.props({
					buildId,
					ignored: getIsIgnored(normalizedSlug, buildId),
					hasDeviceTypeJson: getDeviceTypeJson(normalizedSlug, buildId),
				});
			} catch {
				return;
			}
		},
	);
	const filteredInfo = versionInfo.filter(
		(buildInfo): buildInfo is NonNullable<typeof buildInfo> =>
			buildInfo != null && !!buildInfo.hasDeviceTypeJson && !buildInfo.ignored,
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
