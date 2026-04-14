import {
	sbvrUtils,
	hooks,
	permissions,
	errors as pinejsErrors,
} from '@balena/pinejs';
import * as semver from 'balena-semver';
import type { SemVer } from 'semver';
import type { ReleaseTag, Release } from '../../../balena-model.js';
import type { PickDeferred } from '@balena/abstract-sql-to-typescript';
import { ThisShouldNeverHappenError } from '../../../infra/error-handling/index.js';
const { BadRequestError } = pinejsErrors;

/**
 * We need a fallback to the deprecated release_tags for the version
 * since the versioning format of balenaOS [2019.10.0.dev, 2022.01.0] was non-semver compliant
 * and they were not migrated to the release semver fields.
 */
function getBaseVersionFromReleaseSemverOrTag(
	release: Pick<Release['Read'], 'semver'> & {
		release_tag: Array<Pick<ReleaseTag['Read'], 'value'>>;
	},
) {
	// For OS releases w/ versions that we could not migrate to the semver fields
	// we fallback to the version release_tag.
	if (release.semver.startsWith('0.0.0')) {
		return release.release_tag[0]?.value;
	}
	// We do not use the raw_version since
	// * it adds the variant, which would break comparisons w/ device.os_version (which doesn't include a variant)
	// * it adds the timestamp as a prerelease part,
	//   which would block updates to draft OS releases of the same major.minor.patch.
	return release.semver;
}

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * Disallow hostapp downgrades, using the related release resource
	 */
	async PRERUN(args) {
		if (args.request.values.should_be_operated_by__release != null) {
			// First try to coerce the value to an integer for
			// moving forward
			args.request.custom.hostappRelease = parseInt(
				args.request.values.should_be_operated_by__release,
				10,
			);
			// But let's check we actually got a value
			// representing an integer
			if (!Number.isInteger(args.request.custom.hostappRelease)) {
				throw new BadRequestError('Expected an ID for the hostapp release');
			}
			// Users shouldn't be able to upgrade to an invalid release, but the platform
			// should be able to preserve the should_be_operated_by__release > os_version invariant
			// even if the device reports an os_version that's of an invalidated release.
			const allowInvalidated =
				args.api.passthrough.req?.user === permissions.root.user;

			// Ensure that we don't ever downgrade the hostapp
			// from it's current version
			const ids = await sbvrUtils.getAffectedIds(args);
			await checkHostappReleaseUpgrades(
				args.api,
				ids,
				args.request.custom.hostappRelease,
				allowInvalidated,
			);
		}
	},
});

async function checkHostappReleaseUpgrades(
	api: typeof sbvrUtils.api.resin,
	deviceIds: number[],
	newHostappReleaseId: number,
	allowInvalidated: boolean,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			$select: 'os_version',
			$filter: {
				id: { $in: deviceIds },
				os_version: { $ne: null },
			},
		},
	});

	let maxOldOsVersion: string | undefined;
	for (const device of devices) {
		if (
			// to keep TS happy
			device.os_version != null &&
			semver.parse(device.os_version) != null &&
			(maxOldOsVersion == null || semver.gt(device.os_version, maxOldOsVersion))
		) {
			maxOldOsVersion = device.os_version;
		}
	}

	if (maxOldOsVersion == null) {
		// all devices have yet to fully provision, or have unrecognizable versions,
		// so it's not an upgrade that we can check
		return;
	}

	// In order to prevent blocking devices from provisioning, we allow devices to come online, report any version and
	// we tag it accordingly. However we do not allow devices to _upgrade_ to invalidated releases, so we filter those
	// out here.
	const newHostappRelease = await api.get({
		resource: 'release',
		id: newHostappReleaseId,
		options: {
			$select: 'semver',
			$expand: {
				release_tag: {
					$select: 'value',
					$filter: { tag_key: 'version' },
				},
			},
			$filter: {
				...(!allowInvalidated && {
					// Users shouldn't be able to upgrade to an invalid release, but we can provision to an invalidated one
					// which the device might report on a subsequent PATCH, so this isn't an SBVR rule.
					is_invalidated: false,
				}),
				status: 'success',
			},
		},
	} as const);

	if (newHostappRelease == null) {
		throw new BadRequestError(
			`Could not find a hostapp release with this ID ${newHostappReleaseId}`,
		);
	}

	const newHostappVersion =
		getBaseVersionFromReleaseSemverOrTag(newHostappRelease);

	if (newHostappVersion == null) {
		throw new BadRequestError(
			`Could not find the version for the hostapp release with ID: ${newHostappReleaseId}`,
		);
	}

	if (semver.lt(newHostappVersion, maxOldOsVersion)) {
		throw new BadRequestError(
			`Attempt to downgrade hostapp, which is not allowed`,
		);
	}
}

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * If a device changes device types, we need to clear out the related target hostapp release
	 *
	 * TODO: changing device types presents us with a bit of a conundrum. since we cannot guarantee parity between
	 * available OSes for each device type, we cannot just switch the target to the new device type, so instead let's just
	 * unset the value
	 */

	POSTPARSE({ request }) {
		if (
			request.values.is_of__device_type != null &&
			request.values.should_be_operated_by__release === undefined
		) {
			request.values.should_be_operated_by__release = null;
		}
	},
});

const parseOsVariant = (value: string | null | undefined) => {
	if (value === 'dev' || value === 'prod') {
		return value;
	}
	return null;
};

/**
 * Enforce the "device.should_be_operated_by__release[0].semver >= device.os_version" invariant.
 * When a device reports its current OS version and the release pointed to by the should_be_operated_by__release
 * is lower than the reported os_version or null, we find the hostApp release for the os_version and update the
 * device's should_be_operated_by__release.
 * Setting the should_be_operated_by__release when it's null has the semantics of pinning the device to its current OS release.
 */
hooks.addPureHook('PATCH', 'resin', 'device', {
	async POSTRUN(args) {
		let parsedOsVersion: SemVer | null = null;
		if (typeof args.request.values.os_version === 'string') {
			parsedOsVersion = semver.parse(args.request.values.os_version);
			// If balena-semver can't parse the os_version, then we can be sure
			// that there is no hostApp release matching it.
			if (parsedOsVersion == null) {
				return;
			}
		}
		if (
			parsedOsVersion != null ||
			parseOsVariant(args.request.values.os_variant) != null
		) {
			const ids = await sbvrUtils.getAffectedIds(args);
			await progressTargetOSReleaseIfNewer(args.api, ids);
		}
	},
});

hooks.addPureHook('POST', 'resin', 'device', {
	async POSTPARSE({ request, api }) {
		if (
			request.values.os_version != null &&
			request.values.os_variant != null &&
			request.values.is_of__device_type != null
		) {
			const parsedOsVersion = semver.parse(request.values.os_version);
			// If balena-semver can't parse the os_version, then we can be sure
			// that there is no hostApp release matching it.
			if (parsedOsVersion == null) {
				return;
			}
			const hostappRelease = await getOSReleaseResource(
				api,
				request.values.is_of__device_type,
				parsedOsVersion,
				request.values.os_variant,
			);
			// since this is a POST, we _know_ the device is being created and has no current/target state, so we can
			// just append the target after determining which it is (like a preloaded app)
			if (hostappRelease != null) {
				request.values.should_be_operated_by__release = hostappRelease.id;
			}
		}
	},
});

async function progressTargetOSReleaseIfNewer(
	api: typeof sbvrUtils.api.resin,
	deviceIds: number[],
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			$select: ['id', 'is_of__device_type', 'os_version', 'os_variant'],
			$expand: {
				should_be_operated_by__release: {
					$select: 'semver',
					$expand: {
						release_tag: {
							$select: 'value',
							$filter: { tag_key: 'version' },
						},
					},
				},
			},
			$filter: {
				id: { $in: deviceIds },
			},
		},
	});
	const deviceInfosToUpdate = devices
		.map((device) => {
			const newOsVersion = semver.parse(device.os_version);
			// If balena-semver can't parse the os_version, then we can be sure
			// that there is no hostApp release matching it.
			if (newOsVersion == null) {
				return;
			}
			const newOsVariant = parseOsVariant(device.os_variant);
			if (newOsVariant == null) {
				return;
			}
			return {
				id: device.id,
				deviceTypeId: device.is_of__device_type.__id,
				newOsVersion,
				newOsVariant,
				targetHostappRelease: device.should_be_operated_by__release[0],
			};
		})
		.filter((deviceInfo): deviceInfo is NonNullable<typeof deviceInfo> => {
			if (deviceInfo == null) {
				return false;
			}
			if (deviceInfo.targetHostappRelease == null) {
				return true;
			}
			const targetHostappVersion = getBaseVersionFromReleaseSemverOrTag(
				deviceInfo.targetHostappRelease,
			);
			return (
				targetHostappVersion == null ||
				semver.gt(deviceInfo.newOsVersion.raw, targetHostappVersion)
			);
		});

	if (deviceInfosToUpdate.length === 0) {
		return;
	}

	const groupedDeviceInfos = Map.groupBy(
		deviceInfosToUpdate,
		(di) => `${di.deviceTypeId}|${di.newOsVersion.raw}|${di.newOsVariant}`,
	);
	if (groupedDeviceInfos.size === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
			tx: api.passthrough.tx,
		},
	});

	return Promise.all(
		groupedDeviceInfos.values().map(async (affectedDevices) => {
			// The devices are grouped by these props, so we can pick them by the first record
			// since all devices of the group are expected to have the same values.
			const { deviceTypeId, newOsVersion, newOsVariant } = affectedDevices[0];
			const newOsRelease = await getOSReleaseResource(
				api,
				deviceTypeId,
				newOsVersion,
				newOsVariant,
			);

			if (newOsRelease == null) {
				// When the newOsRelease is not found, and since we have already checked that
				// newOsVersion > should_be_operated_by__release, we need to clear the
				// should_be_operated_by__release of devices that have it set, otherwise the
				// should_be_operated_by__release >= os_version invariant would be violated.
				affectedDevices = affectedDevices.filter(
					(d) => d.targetHostappRelease != null,
				);
				if (affectedDevices.length === 0) {
					return;
				}
			}

			const affectedDeviceIds = affectedDevices.map((d) => d.id);
			await rootApi.patch({
				resource: 'device',
				options: {
					$filter: {
						id: { $in: affectedDeviceIds },
					},
				},
				body: {
					should_be_operated_by__release: newOsRelease?.id ?? null,
				},
			});
		}),
	);
}

async function getOSReleaseResource(
	api: typeof sbvrUtils.api.resin,
	deviceTypeId: number,
	parsedOsVersion: SemVer,
	osVariant: string,
): Promise<PickDeferred<Release['Read'], 'id' | 'is_final'> | undefined> {
	const releases = await api.get({
		resource: 'release',
		options: {
			$top: 2,
			$select: ['id', 'is_final'],
			$filter: {
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								is_for__device_type: deviceTypeId,
								is_host: true,
							},
						},
					},
				},
				$or: [
					{
						// This effectively normalizes the versions string and
						// compares it with the `semver` computed term, but we are
						// using the individual fields so that DB indexes can also be used.
						semver_major: parsedOsVersion.major,
						semver_minor: parsedOsVersion.minor,
						semver_patch: parsedOsVersion.patch,
						semver_prerelease: parsedOsVersion.prerelease.join('.'),
						semver_build: parsedOsVersion.build.join('.'),
						$or: [
							{ revision: getRevisionFromSemver(parsedOsVersion) ?? 0 },
							// Matching with NULL as well, allows provisioning devices to draft OS releases
							{ revision: null },
						],
						// The OS release has to either have a matching variant,
						// or have no variant (when it's an invariant/unified release).
						variant: { $in: [osVariant, ''] },
					},
					{
						// We still need to be filtering hostApp releases based on the deprecated release_tags,
						// since the versioning format of balenaOS [2019.10.0.dev, 2022.01.0] was non-semver compliant
						// and they were not migrated to the release semver fields.
						$and: [
							{
								release_tag: {
									$any: {
										$alias: 'rt',
										$expr: {
											rt: {
												// We can't use the result from balena-semver for this filter,
												// b/c balena-semver normalizes invalid semvers like
												// 2022.01.0 to 2022.1.0 and that would no longer
												// match the tag value.
												value: normalizeOsVersion(parsedOsVersion.raw),
												tag_key: 'version',
											},
										},
									},
								},
							},
							{
								// The OS release has to either have a matching variant,
								// or have no variant release_tag (when it's an invariant/unified release).
								$or: [
									{
										release_tag: {
											$any: {
												$alias: 'rt',
												$expr: {
													rt: {
														value: normalizeVariantToLongForm(osVariant),
														tag_key: 'variant',
													},
												},
											},
										},
									},
									{
										$not: {
											release_tag: {
												$any: {
													$alias: 'rt',
													$expr: {
														rt: {
															tag_key: 'variant',
														},
													},
												},
											},
										},
									},
								],
							},
						],
					},
				],
			},
			$orderby: [
				{
					// We order the resuts by semver_major DESC so that we always prefer rows
					// that were matched via the semver fields rather than tags in case of a conflict,
					// (since versions using only tags would have a 0.0.0 semver).
					semver_major: 'desc',
				},
				{
					// When there are both finalized & draft releases
					// we should prefer picking the finalized one
					is_final: 'desc',
				},
				{
					created_at: 'desc',
				},
			],
		},
	});
	const [release] = releases;
	if (releases.filter((r) => r.is_final).length > 1) {
		ThisShouldNeverHappenError(
			`Found more than one finalized hostApp release matching version ${parsedOsVersion.raw} ${osVariant} for device type ${deviceTypeId} and returned ${release.id}.`,
		);
	}

	return release;
}

function getRevisionFromSemver(parsedOsVersion: SemVer): number | undefined {
	const revisionRegex = /^rev(\d+)$/;
	for (const buildPart of parsedOsVersion.build) {
		const match = buildPart.match(revisionRegex)?.[1];
		if (match != null) {
			return parseInt(match, 10);
		}
	}
	return;
}

function normalizeVariantToLongForm(variant: string) {
	switch (variant) {
		case 'prod':
			return 'production';
		case 'dev':
			return 'development';
		default:
			return variant;
	}
}

function normalizeOsVersion(osVersion: string) {
	// Remove "Resin OS" and "Balena OS" text
	return (
		osVersion
			.replace(/(resin|balena)\s*os\s*/gi, '')
			// Remove optional versioning, eg "(prod)", "(dev)"
			.replace(/\s+\(\w+\)$/, '')
			// Remove "v" prefix
			.replace(/^v/, '')
	);
}
