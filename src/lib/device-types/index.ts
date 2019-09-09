import * as arraySort from 'array-sort';
import * as Promise from 'bluebird';
import * as _ from 'lodash';
import { InternalRequestError } from '@resin/pinejs/out/sbvr-api/errors';
import * as deviceTypesLib from '@resin.io/device-types';
import * as semver from 'resin-semver';
import { sbvrUtils, PinejsClient, resinApi, root, Tx } from '../../platform';
import { captureException } from '../../platform/errors';
import {
	getCompressedSize,
	getDeviceTypeJson,
	getIsIgnored,
} from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';
import { db } from '../../platform';

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

interface DeviceTypeWithAliases extends DeviceType {
	aliases?: string[];
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

const getBuildData = (slug: string, buildId: string) => {
	return Promise.join(
		getIsIgnored(slug, buildId),
		getDeviceTypeJson(slug, buildId).catchReturn(undefined),
		(ignored, deviceType) => {
			const buildInfo = {
				ignored,
				deviceType,
			};

			return buildInfo;
		},
	);
};

const getFirstValidBuild = (
	slug: string,
	versions: string[],
): Promise<BuildInfo | undefined> => {
	if (_.isEmpty(versions)) {
		return Promise.resolve() as Promise<BuildInfo | undefined>;
	}

	const buildId = versions[0];
	return getBuildData(slug, buildId)
		.catch(err => {
			captureException(
				err,
				`Failed to get device type build data for ${slug}/${buildId}`,
			);
		})
		.then(buildInfo => {
			if (buildInfo && !buildInfo.ignored && buildInfo.deviceType) {
				// TS can't infer this correctly and gets confused when
				// checking it against the Promise return value
				return buildInfo as BuildInfo;
			}

			return getFirstValidBuild(slug, _.tail(versions));
		});
};

function fetchDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	const result: Dictionary<DeviceTypeInfo> = {};
	getIsIgnored.clear();
	getDeviceTypeJson.clear();
	return listFolders(IMAGE_STORAGE_PREFIX)
		.map(slug => {
			return listFolders(getImageKey(slug))
				.then(builds => {
					if (_.isEmpty(builds)) {
						return;
					}

					const sortedBuilds = sortBuildIds(builds);
					return getFirstValidBuild(slug, sortedBuilds).then(
						latestBuildInfo => {
							if (!latestBuildInfo) {
								return;
							}

							result[slug] = {
								versions: builds,
								latest: latestBuildInfo,
							};

							_.forEach(
								(latestBuildInfo.deviceType as DeviceTypeWithAliases).aliases,
								alias => {
									result[alias] = result[slug];
								},
							);
						},
					);
				})
				.catch(err => {
					captureException(
						err,
						`Failed to find a valid build for device type ${slug}`,
					);
				})
				.return(slug);
		})
		.then(slugs => {
			if (_.isEmpty(result) && !_.isEmpty(slugs)) {
				throw new InternalRequestError('Could not retrieve any device type');
			}
		})
		.return(result)
		.catch(err => {
			captureException(err, 'Failed to get device types');
			return Promise.delay(RETRY_DELAY).then(fetchDeviceTypes);
		});
}

let deviceTypesCache: Promise<Dictionary<DeviceTypeInfo>> | undefined;

function updateDeviceTypesCache(
	freshDeviceTypes: Promise<Dictionary<DeviceTypeInfo>>,
) {
	if (!deviceTypesCache) {
		deviceTypesCache = freshDeviceTypes;
		return freshDeviceTypes;
	}
	return Promise.join(
		deviceTypesCache,
		freshDeviceTypes,
		(cachedDeviceTypes, freshDeviceTypes) => {
			const removedDeviceTypes = _.difference(
				_.keys(cachedDeviceTypes),
				_.keys(freshDeviceTypes),
			);
			removedDeviceTypes.forEach(
				removedDeviceType => delete cachedDeviceTypes[removedDeviceType],
			);

			_.forEach(freshDeviceTypes, (freshDeviceType, slug) => {
				const cachedDeviceType = cachedDeviceTypes[slug];
				if (!cachedDeviceType) {
					cachedDeviceTypes[slug] = freshDeviceType;
				}
			});
		},
	).tapCatch(err => {
		captureException(err, 'Failed to update device type cache');
	});
}

function updateDTModel(
	deviceType: deviceTypesLib.DeviceType,
	propertyMap: typeof syncSettings['map'],
	tx: Tx,
) {
	const apiTx = resinApi.clone({ passthrough: { req: root, tx } });
	const updateFields = _.mapValues(
		propertyMap,
		source => (deviceType as AnyObject)[source.name] || source.default,
	);
	const updateFilter: AnyObject[] = _.reduce(
		propertyMap,
		(result, value, key) => {
			const filter: AnyObject = {};
			filter[key] = {
				$ne: (deviceType as AnyObject)[value.name] || value.default,
			};
			result.push(filter);
			return result;
		},
		[] as AnyObject[],
	);
	return apiTx
		.get({
			resource: 'device_type_table',
			options: {
				$filter: {
					slug: deviceType.slug,
				},
				$select: ['id'],
			},
		})
		.then((results: AnyObject[]) => {
			if (results.length === 0) {
				const body = _.cloneDeep({
					slug: deviceType.slug,
				});
				_.merge(body, updateFields);
				return apiTx
					.post({
						resource: 'device_type_table',
						body,
						options: { returnResource: false },
					})
					.return();
			} else if (results.length > 1) {
				throw new Error(
					`updateOrInsert filter not unique for 'device_type': '${JSON.stringify(
						{
							slug: deviceType.slug,
						},
					)}'`,
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
				return apiTx
					.patch({
						resource: 'device_type_table',
						id: results[0].id,
						body: updateFields,
						options: {
							$filter: filter,
						},
					})
					.return();
			}
		});
}

function syncDataModel(
	types: Dictionary<DeviceTypeInfo>,
	propertyMap: typeof syncSettings['map'],
) {
	if (_.isEmpty(_.keys(propertyMap))) {
		captureException(
			new Error('No properties to sync into the device type model'),
		);
		return;
	}
	return db.transaction(tx => {
		return Promise.each(Object.values(types), deviceTypeInfo => {
			const deviceType = deviceTypeInfo.latest.deviceType;
			return updateDTModel(deviceType, propertyMap, tx);
		});
	});
}

function fetchDeviceTypesAndReschedule(): Promise<Dictionary<DeviceTypeInfo>> {
	const promise = fetchDeviceTypes()
		.tap(() => {
			// when the promise gets resolved, cache it
			deviceTypesCache = promise;
		})
		.finally(() => {
			// schedule a re-run to update the local cache
			Promise.delay(DEVICE_TYPES_CACHE_EXPIRATION)
				.then(fetchDeviceTypesAndReschedule)
				.catch(err => {
					captureException(err, 'Failed to re-fetch device types');
				});

			// silence the promise created but not returned warning
			return null;
		});

	// if the cache is still empty, use this promise so that
	// we do not start a second set of requests to s3
	// in case another api request comes before the first completes
	if (!deviceTypesCache) {
		deviceTypesCache = promise;
	} else {
		updateDeviceTypesCache(promise);
	}

	return promise.tap(deviceTypeInfos => {
		return syncDataModel(deviceTypeInfos, syncSettings.map);
	});
}

function getDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	// Always return the local cache if populated
	if (deviceTypesCache) {
		return deviceTypesCache;
	}

	return fetchDeviceTypesAndReschedule();
}

export const getAccessibleSlugs = (
	api: PinejsClient,
	slugs?: string[],
): Promise<string[]> => {
	const options: AnyObject = {
		$select: ['slug'],
	};
	if (slugs) {
		options['$filter'] = {
			slug: { $in: slugs },
		};
	}
	return api
		.get({
			resource: 'device_type_table',
			options,
		})
		.then((accessibleDeviceTypes: { slug: string }[]) => {
			return _.map(accessibleDeviceTypes, 'slug');
		});
};

export const findDeviceTypeInfoBySlug = (
	api: PinejsClient,
	slug: string,
): Promise<DeviceTypeInfo> =>
	getAccessibleSlugs(api, [slug])
		.then((accessibleDeviceTypes: string[]) => {
			if (_.includes(accessibleDeviceTypes, slug)) {
				// We can access the device type slug
				return;
			}
			// We cannot access the device type
			throw new UnknownDeviceTypeError(slug);
		})
		.then(getDeviceTypes)
		.then(deviceTypeInfos => {
			// the slug can be an alias,
			// since the Dictionary also has props for the aliases
			const deviceTypeInfo = deviceTypeInfos[slug];
			if (!deviceTypeInfo || !deviceTypeInfo.latest) {
				throw new UnknownDeviceTypeError(slug);
			}
			return deviceTypeInfos[slug];
		});

export const validateSlug = (slug?: string) => {
	if (slug == null || !/^[\w-]+$/.test(slug)) {
		throw new InvalidDeviceTypeError('Invalid device type');
	}
	return slug;
};

export const deviceTypes = (api: PinejsClient): Promise<DeviceType[]> => {
	return Promise.join(
		getDeviceTypes(),
		getAccessibleSlugs(api),
		(
			deviceTypesInfos: Dictionary<DeviceTypeInfo>,
			accessibleDeviceTypes: string[],
		) => {
			const accessSet = new Set(accessibleDeviceTypes);
			const deviceTypes: DeviceType[] = _(deviceTypesInfos)
				.filter((deviceTypesInfo: DeviceTypeInfo, slug: string) => {
					const dtSlug = deviceTypesInfo.latest.deviceType.slug;
					return dtSlug === slug && accessSet.has(dtSlug);
				})
				.map(deviceTypesInfo => deviceTypesInfo.latest.deviceType)
				.value();
			return deviceTypes;
		},
	);
};

export const findBySlug = (
	api: PinejsClient,
	slug: string,
): Promise<DeviceType> =>
	deviceTypes(api)
		.then(deviceTypes => deviceTypesLib.findBySlug(deviceTypes, slug))
		.then(deviceType => {
			if (deviceType == null) {
				throw new UnknownDeviceTypeError(slug);
			}
			// use a .then() & return instead of .tap(),
			// so that the result is inferred as non-nullable
			return deviceType;
		});

export const normalizeDeviceType = (
	api: PinejsClient,
	slug: string,
): Promise<string> => {
	if (SPECIAL_SLUGS.includes(slug)) {
		return Promise.resolve(slug);
	}

	return deviceTypes(api)
		.then(deviceTypes => deviceTypesLib.normalizeDeviceType(deviceTypes, slug))
		.tap(normalizedSlug => {
			if (normalizedSlug == null) {
				throw new UnknownDeviceTypeError(slug);
			}
		});
};

export const getImageSize = (
	api: PinejsClient,
	slug: string,
	buildId: string,
) => {
	return findDeviceTypeInfoBySlug(api, slug).then(deviceTypeInfo => {
		const deviceType = deviceTypeInfo.latest.deviceType;
		const normalizedSlug = deviceType.slug;

		if (buildId === 'latest') {
			buildId = deviceType.buildId;
		}

		if (!deviceTypeInfo.versions.includes(buildId)) {
			throw new UnknownVersionError(slug, buildId);
		}

		return Promise.join(
			getIsIgnored(normalizedSlug, buildId),
			getDeviceTypeJson(normalizedSlug, buildId),
			(ignored, hasDeviceTypeJson) => {
				if (ignored || !hasDeviceTypeJson) {
					throw new UnknownVersionError(slug, buildId);
				}

				return getCompressedSize(normalizedSlug, buildId).tapCatch(err => {
					captureException(
						err,
						`Failed to get device type ${slug} compressed size for version ${buildId}`,
					);
				});
			},
		);
	});
};

export interface ImageVersions {
	versions: string[];
	latest: string;
}

export const getDeviceTypeIdBySlug = (
	api: PinejsClient,
	slug: string,
): Promise<{ id: number; slug: string }> => {
	return normalizeDeviceType(api, slug)
		.then(deviceType => {
			return api.get({
				resource: 'device_type_table',
				options: {
					$select: ['id', 'slug'],
					$filter: {
						slug: deviceType,
					},
				},
			});
		})
		.then(([dt]: { id: number; slug: string }[]) => {
			return dt;
		});
};

export const getImageVersions = (
	api: PinejsClient,
	slug: string,
): Promise<ImageVersions> => {
	return findDeviceTypeInfoBySlug(api, slug).then(deviceTypeInfo => {
		const deviceType = deviceTypeInfo.latest.deviceType;
		const normalizedSlug = deviceType.slug;

		return Promise.map(deviceTypeInfo.versions, buildId => {
			return Promise.props({
				buildId,
				ignored: getIsIgnored(normalizedSlug, buildId),
				hasDeviceTypeJson: getDeviceTypeJson(normalizedSlug, buildId),
			}).catchReturn(undefined);
		}).then(versionInfo => {
			const filteredInfo = versionInfo.filter(
				(buildInfo): buildInfo is NonNullable<typeof buildInfo> =>
					buildInfo != null &&
					!!buildInfo.hasDeviceTypeJson &&
					!buildInfo.ignored,
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
		});
	});
};
