import _ from 'lodash';

import type { DeviceTypeJson } from './device-type-json.js';
import type { sbvrUtils } from '@balena/pinejs';
import { errors } from '@balena/pinejs';
const { InternalRequestError } = errors;

import { captureException } from '../../infra/error-handling/index.js';

import { getCompressedSize, getDeviceTypeJson } from './build-info-facade.js';
import type { DeviceTypeInfo } from './device-types-list.js';
import { getDeviceTypes } from './device-types-list.js';
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

/**
 * Resolves a device type by slug or alias & performs access control for DTs against the database.
 * @param resinApi The pinejs client
 * @param slug The slug or alias to check.
 */
export const getDeviceTypeBySlug = async (
	resinApi: typeof sbvrUtils.api.resin,
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
	resinApi: typeof sbvrUtils.api.resin,
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
	resinApi: typeof sbvrUtils.api.resin,
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
	resinApi: typeof sbvrUtils.api.resin,
	slug: string,
): Promise<DeviceTypeJson> =>
	(await findDeviceTypeInfoBySlug(resinApi, slug)).latest;

export const getImageSize = async (
	resinApi: typeof sbvrUtils.api.resin,
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
	resinApi: typeof sbvrUtils.api.resin,
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
