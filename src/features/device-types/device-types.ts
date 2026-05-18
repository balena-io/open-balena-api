import * as semver from 'balena-semver';
import type { DeviceTypeJson } from './device-type-json.js';
import type { sbvrUtils } from '@balena/pinejs';
import { errors } from '@balena/pinejs';

import {
	captureException,
	ThisShouldNeverHappenError,
} from '../../infra/error-handling/index.js';

import { getCompressedSize, getDeviceTypeJson } from './build-info-facade.js';
import { getDeviceTypes } from './device-types-list.js';
import type { DeviceTypeInfo } from './device-types-list.js';
import type { Release } from '../../balena-model.js';
import type { Filter } from 'pinejs-client-core';
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
	const [dt] = await resinApi.get({
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
	});

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

/** @deprecated Prefer querying the device_type resource directly unless you need the device-type.json contents. */
export const getAccessibleDeviceTypeJsons = async (
	resinApi: typeof sbvrUtils.api.resin,
): Promise<DeviceTypeJson[]> => {
	const [deviceTypeInfosBySlug, accessibleDeviceTypes] = await Promise.all([
		getDeviceTypes(),
		resinApi.get({
			resource: 'device_type',
			options: {
				$select: 'slug',
			},
		}),
	]);

	return accessibleDeviceTypes
		.map((dt) => deviceTypeInfosBySlug[dt.slug]?.latest)
		.filter((dtJson) => dtJson != null);
};

/** @deprecated Use the getDeviceTypeBySlug unless you need the device-type.json contents. */
export const getDeviceTypeJsonBySlug = async (
	resinApi: typeof sbvrUtils.api.resin,
	slug: string,
): Promise<DeviceTypeJson> =>
	(await findDeviceTypeInfoBySlug(resinApi, slug)).latest;

// Quick way to infer whether a release version looks like an ESR (eg :2020.1.0)
// TODO: Drop this once we add support for ESR releases to the download size estimate endpoint.
const ESR_MIN_MAJOR = 2000;

export const getImageSize = async (
	resinApi: typeof sbvrUtils.api.resin,
	slug: string,
	buildId: string,
): Promise<number> => {
	const deviceType = await getDeviceTypeBySlug(resinApi, slug);
	const normalizedSlug = deviceType.slug;

	const parsedOsVersion =
		buildId === 'latest' ? 'latest' : semver.parse(buildId);
	if (parsedOsVersion == null) {
		throw new UnknownVersionError(slug, buildId);
	}
	if (parsedOsVersion !== 'latest' && parsedOsVersion.major >= ESR_MIN_MAJOR) {
		// We atm do not support ESR releases.
		throw new UnknownVersionError(slug, buildId);
	}

	let releaseFilters: Filter<Release['Read']>;
	if (parsedOsVersion === 'latest') {
		releaseFilters = {
			is_invalidated: false,
			// Avoid any ESR-looking release that might have been accidentally
			// published under the wrong hostApp.
			semver_major: { $lt: ESR_MIN_MAJOR },
		};
	} else {
		const revision = semver.getRevision(parsedOsVersion) ?? 0;
		const variant =
			parsedOsVersion.build.find((b) => b === 'dev' || b === 'prod') ?? '';
		releaseFilters = {
			// We do not filter on the raw_version (computed term) directly
			// but prefer filtering on the individual fields, so that the DB indexes are used,
			// and since it works for both draft & finalized releases.
			semver_major: parsedOsVersion.major,
			semver_minor: parsedOsVersion.minor,
			semver_patch: parsedOsVersion.patch,
			semver_prerelease: parsedOsVersion.prerelease.join('.'),
			semver_build: parsedOsVersion.build
				.filter((b) => b !== variant)
				.join('.'),
			variant,
			$or: [{ revision: null }, { revision }],
		};
	}

	const releases = await resinApi.get({
		resource: 'release',
		options: {
			$top: parsedOsVersion === 'latest' ? 1 : 2,
			$select: ['semver', 'variant'],
			$filter: {
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								is_host: true,
								is_for__device_type: deviceType.id,
							},
							// We atm do not support ESR releases.
							// We can evaluate doing so via an endpoint that also accepts the hostApp as a param
							// so that the result is unique.
							$not: {
								a: {
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
				},
				status: 'success',
				...releaseFilters,
			},
			$orderby: [
				// prefer finalized releases over draft
				{ is_final: 'desc' },
				// prefer the highest semver wise release
				{ semver_major: 'desc' },
				{ semver_minor: 'desc' },
				{ semver_patch: 'desc' },
				{ revision: 'desc' },
				{ semver_prerelease: 'desc' },
				// prefer prod over dev
				{ variant: 'desc' },
				{ created_at: 'desc' },
			],
		},
	});

	if (releases.length > 1) {
		throw ThisShouldNeverHappenError(
			`Found more than one OS releases for device-type ${slug} and version ${buildId}`,
		);
	}

	const [release] = releases;
	if (release == null) {
		throw new UnknownVersionError(slug, buildId);
	}

	// The key prefix on S3 matches the semver (w/o draft parts) that the OS team used.
	buildId =
		release.variant !== ''
			? `${release.semver}.${release.variant}`
			: release.semver;

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
