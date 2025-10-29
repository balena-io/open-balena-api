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
import { groupByMap } from '../../../lib/utils.js';
import { ThisShouldNeverHappenError } from '../../../infra/error-handling/index.js';
const { BadRequestError } = pinejsErrors;

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

			// Ensure that we don't ever downgrade the hostapp
			// from it's current version
			const ids = await sbvrUtils.getAffectedIds(args);
			await checkHostappReleaseUpgrades(
				args.api,
				ids,
				args.request.custom.hostappRelease,
			);
		}
	},
});

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

/**
 * Enforce the "device.should_be_operated_by__release[0].semver >= device.os_version" invariant.
 * When a device reports its current OS version and the release pointed to by the should_be_operated_by__release
 * is lower than the reported os_version or null, we find the hostApp release for the os_version and update the
 * device's should_be_operated_by__release.
 * Setting the should_be_operated_by__release when it's null has the semantics of pinning the device to its current OS release.
 */
hooks.addPureHook('PATCH', 'resin', 'device', {
	async PRERUN(args) {
		if (
			args.request.values.os_version != null &&
			args.request.values.os_variant != null
		) {
			const parsedOsVersion = semver.parse(args.request.values.os_version);
			// If balena-semver can't parse the os_version, then we can be sure
			// that there is no hostApp release matching it.
			if (parsedOsVersion == null) {
				return;
			}
			const ids = await sbvrUtils.getAffectedIds(args);
			await setOSReleaseIfNewer(
				args.api,
				ids,
				parsedOsVersion,
				args.request.values.os_variant,
			);
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
				parsedOsVersion,
				request.values.os_variant,
				request.values.is_of__device_type,
			);
			// since this is a POST, we _know_ the device is being created and has no current/target state, so we can
			// just append the target after determining which it is (like a preloaded app)
			if (hostappRelease != null) {
				request.values.should_be_operated_by__release = hostappRelease.id;
			}
		}
	},
});

async function setOSReleaseIfNewer(
	api: typeof sbvrUtils.api.resin,
	deviceIds: number[],
	newOsVersion: SemVer,
	newOsVariant: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			$select: ['id', 'is_of__device_type'],
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
	const devicesToUpdate = devices.filter((device) => {
		const targetHostappRelease = device.should_be_operated_by__release[0];
		if (targetHostappRelease == null) {
			return true;
		}
		const targetHostappVersion =
			getBaseVersionFromReleaseSemverOrTag(targetHostappRelease);
		return (
			targetHostappVersion == null ||
			semver.gt(newOsVersion.raw, targetHostappVersion)
		);
	});

	if (devicesToUpdate.length === 0) {
		return;
	}

	const devicesByDeviceTypeId = groupByMap(
		devicesToUpdate,
		(d) => d.is_of__device_type.__id,
	);
	if (devicesByDeviceTypeId.size === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
			tx: api.passthrough.tx,
		},
	});

	return Promise.all(
		Array.from(devicesByDeviceTypeId.entries()).map(
			async ([deviceTypeId, affectedDevices]) => {
				const newOsRelease = await getOSReleaseResource(
					api,
					newOsVersion,
					newOsVariant,
					deviceTypeId,
				);

				if (newOsRelease == null) {
					// When the newOsRelease is not found, and since we have already checked that
					// newOsVersion > should_be_operated_by__release, we need to clear the
					// should_be_operated_by__release of devices that have it set, otherwise the
					// should_be_operated_by__release >= os_version invariant would be violated.
					affectedDevices = affectedDevices.filter(
						(d) => d.should_be_operated_by__release[0] != null,
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
			},
		),
	);
}

async function getOSReleaseResource(
	api: typeof sbvrUtils.api.resin,
	parsedOsVersion: SemVer,
	osVariant: string,
	deviceTypeId: number,
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
	// We do not use the raw_version since adds the timestamp as a prerelease part
	// and that would block updates to draft OS releases of the same major.minor.patch.
	return release.semver;
}

async function checkHostappReleaseUpgrades(
	api: typeof sbvrUtils.api.resin,
	deviceIds: number[],
	newHostappReleaseId: number,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const nullHostappCount = await api.get({
		resource: 'device',
		options: {
			$count: {
				$filter: { id: { $in: deviceIds }, os_version: null },
			},
		},
	});

	if (nullHostappCount === deviceIds.length) {
		// all devices have yet to fully provision, so it's not an upgrade
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
				// we shouldn't be able to upgrade to an invalid release, but we can provision to one (so this isn't an
				// SBVR rule)
				is_invalidated: false,
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

	const oldOsReleases = await api.get({
		resource: 'release',
		options: {
			$select: 'semver',
			$expand: {
				release_tag: {
					$select: 'value',
					$filter: { tag_key: 'version' },
				},
			},
			$filter: {
				id: { $ne: newHostappReleaseId },
				should_operate__device: {
					$any: {
						$alias: 'd',
						$expr: {
							d: {
								id: {
									$in: deviceIds,
								},
							},
						},
					},
				},
			},
		},
	} as const);

	for (const oldOsRelease of oldOsReleases) {
		const oldVersion = getBaseVersionFromReleaseSemverOrTag(oldOsRelease);
		// Let the device upgrade if it is operated by a release w/ 0.0.0 semver,
		// & no version release_tag, since it might be legacy.
		if (oldVersion != null && semver.lt(newHostappVersion, oldVersion)) {
			throw new BadRequestError(
				`Attempt to downgrade hostapp, which is not allowed`,
			);
		}
	}
}
