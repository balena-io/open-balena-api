import {
	sbvrUtils,
	hooks,
	permissions,
	errors as pinejsErrors,
} from '@balena/pinejs';
import * as semver from 'balena-semver';
import * as _ from 'lodash';
import { Device, ReleaseTag, PickDeferred } from '../../../balena-model';
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

	async POSTPARSE({ request }) {
		if (
			request.values.is_of__device_type != null &&
			request.values.should_be_operated_by__release === undefined
		) {
			request.values.should_be_operated_by__release = null;
		}
	},
});

/**
 * When a device checks in with it's initial OS version, set the corresponding should_be_operated_by__release resource
 * using its current reported version.
 */
hooks.addPureHook('PATCH', 'resin', 'device', {
	async PRERUN(args) {
		if (
			args.request.values.os_version != null &&
			args.request.values.os_variant != null
		) {
			const ids = await sbvrUtils.getAffectedIds(args);
			await setOSReleaseResource(
				args.api,
				ids,
				args.request.values.os_version,
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
			const [hostappRelease] = await getOSReleaseResource(
				api,
				request.values.os_version,
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

async function setOSReleaseResource(
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	osVersion: string,
	osVariant: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = (await api.get({
		resource: 'device',
		options: {
			// if the device already has an os_version, just bail.
			$filter: {
				id: { $in: deviceIds },
				os_version: null,
			},
			$select: ['id', 'is_of__device_type'],
		},
	})) as Array<PickDeferred<Device, 'id' | 'is_of__device_type'>>;

	if (devices.length === 0) {
		return;
	}

	const devicesByDeviceType = _.groupBy(devices, (d) => {
		return d.is_of__device_type.__id;
	});

	if (Object.keys(devicesByDeviceType).length === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
			tx: api.passthrough.tx,
		},
	});

	return Promise.all(
		_.map(devicesByDeviceType, async (affectedDevices, deviceType) => {
			const affectedDeviceIds = affectedDevices.map((d) => d.id);

			const [osRelease] = await getOSReleaseResource(
				api,
				osVersion,
				osVariant,
				deviceType,
			);

			if (osRelease == null) {
				return;
			}

			await rootApi.patch({
				resource: 'device',
				options: {
					$filter: {
						id: { $in: affectedDeviceIds },
					},
				},
				body: {
					should_be_operated_by__release: osRelease.id,
				},
			});
		}),
	);
}

async function getOSReleaseResource(
	api: sbvrUtils.PinejsClient,
	osVersion: string,
	osVariant: string,
	deviceTypeId: string,
) {
	return await api.get({
		resource: 'release',
		options: {
			$select: ['id', 'belongs_to__application'],
			$filter: {
				// TODO: better to (eventually) use release version, once that's fully supported
				// https://www.flowdock.com/app/rulemotion/resin-tech/threads/Ao4qzbDh8Z4Pgq_xF99Ld5fME35
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
				$and: [
					{
						release_tag: {
							$any: {
								$alias: 'rt',
								$expr: {
									rt: {
										value: normalizeOsVersion(osVersion),
										tag_key: 'version',
									},
								},
							},
						},
					},
					{
						$or: [
							{
								release_tag: {
									$any: {
										$alias: 'rt',
										$expr: {
											rt: {
												value: normalizeVariant(osVariant),
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
		},
	});
}

function normalizeVariant(variant: string) {
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

async function checkHostappReleaseUpgrades(
	api: sbvrUtils.PinejsClient,
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
			$expand: {
				release_tag: { $filter: { tag_key: 'version' }, $select: ['value'] },
			},
			$filter: {
				// we shouldn't be able to upgrade to an invalid release, but we can provision to one (so this isn't an
				// SBVR rule)
				is_invalidated: false,
				status: 'success',
			},
		},
	});

	if (newHostappRelease == null) {
		throw new BadRequestError(
			`Could not find a hostapp release with this ID ${newHostappReleaseId}`,
		);
	}

	// TODO: this validation should eventually use release_version or raw_version, not tags
	const newHostappVersion = newHostappRelease.release_tag[0].value;

	const releases = (await api.get({
		resource: 'release_tag',
		options: {
			$select: ['value'],
			$filter: {
				tag_key: 'version',
				release: {
					$any: {
						$alias: 'r',
						$expr: {
							r: {
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
					},
				},
			},
		},
	})) as Array<Pick<ReleaseTag, 'value'>>;

	for (const release of releases) {
		const oldVersion = release.value;
		if (semver.lt(newHostappVersion, oldVersion)) {
			throw new BadRequestError(
				`Attempt to downgrade hostapp, which is not allowed`,
			);
		}
	}
}
