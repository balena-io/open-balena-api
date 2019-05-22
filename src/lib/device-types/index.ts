import * as arraySort from 'array-sort';
import * as Promise from 'bluebird';
import * as _ from 'lodash';
import { InternalRequestError } from '@resin/pinejs/out/sbvr-api/errors';
import * as deviceTypesLib from '@resin.io/device-types';
import * as semver from 'resin-semver';
import { sbvrUtils } from '../../platform';
import { captureException } from '../../platform/errors';
import {
	getCompressedSize,
	getDeviceTypeJson,
	getIsIgnored,
} from './build-info-facade';
import { getImageKey, IMAGE_STORAGE_PREFIX, listFolders } from './storage';

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
	return Promise.all([
		getIsIgnored(slug, buildId),
		getDeviceTypeJson(slug, buildId).catchReturn(undefined),
	]).then(([ignored, deviceType]) => {
		const buildInfo = {
			ignored,
			deviceType,
		};

		return buildInfo;
	});
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
				throw new InternalRequestError('Clould not retrieve any device type');
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
			_.forEach(
				removedDeviceTypes,
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

	return promise;
}

function getDeviceTypes(): Promise<Dictionary<DeviceTypeInfo>> {
	// Always return the local cache if populated
	if (deviceTypesCache) {
		return deviceTypesCache;
	}

	return fetchDeviceTypesAndReschedule();
}

export const findDeviceTypeInfoBySlug = (
	slug: string,
): Promise<DeviceTypeInfo> =>
	getDeviceTypes().then(deviceTypeInfos => {
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

export const deviceTypes = (): Promise<DeviceType[]> => {
	return getDeviceTypes().then(deviceTypesInfos => {
		// exclude aliases
		return _(deviceTypesInfos)
			.filter(
				(deviceTypesInfo, slug) =>
					deviceTypesInfo.latest.deviceType.slug === slug,
			)
			.map(deviceTypesInfo => deviceTypesInfo.latest.deviceType)
			.value();
	});
};

export const findBySlug = (slug: string): Promise<DeviceType> =>
	deviceTypes()
		.then(deviceTypes => deviceTypesLib.findBySlug(deviceTypes, slug))
		.then(deviceType => {
			if (deviceType == null) {
				throw new UnknownDeviceTypeError(slug);
			}
			// use a .then() & return instead of .tap(),
			// so that the result is inferred as non-nullable
			return deviceType;
		});

export const normalizeDeviceType = (slug: string): Promise<string> => {
	if (SPECIAL_SLUGS.includes(slug)) {
		return Promise.resolve(slug);
	}

	return deviceTypes()
		.then(deviceTypes => deviceTypesLib.normalizeDeviceType(deviceTypes, slug))
		.tap(normalizedSlug => {
			if (normalizedSlug == null) {
				throw new UnknownDeviceTypeError(slug);
			}
		});
};

export const getImageSize = (slug: string, buildId: string) => {
	return findDeviceTypeInfoBySlug(slug).then(deviceTypeInfo => {
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

export const getImageVersions = (slug: string): Promise<ImageVersions> => {
	return findDeviceTypeInfoBySlug(slug).then(deviceTypeInfo => {
		const deviceType = deviceTypeInfo.latest.deviceType;
		const normalizedSlug = deviceType.slug;

		return Promise.map(deviceTypeInfo.versions, buildId => {
			return Promise.props({
				buildId,
				ignored: getIsIgnored(normalizedSlug, buildId),
				hasDeviceTypeJson: getDeviceTypeJson(normalizedSlug, buildId),
			}).catchReturn(undefined);
		})
			.filter(
				buildInfo =>
					!!buildInfo && !!buildInfo.hasDeviceTypeJson && !buildInfo.ignored,
			)
			.then(versionInfos => {
				if (_.isEmpty(versionInfos) && !_.isEmpty(deviceTypeInfo.versions)) {
					throw new InternalRequestError(
						`Clould not retrieve any image version for device type ${slug}`,
					);
				}

				const buildIds = _.map(versionInfos, 'buildId');
				return {
					versions: buildIds,
					latest: buildIds[0],
				};
			});
	});
};
