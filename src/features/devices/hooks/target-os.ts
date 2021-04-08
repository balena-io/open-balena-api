import {
	sbvrUtils,
	hooks,
	permissions,
	errors as pinejsErrors,
} from '@balena/pinejs';
import * as semver from 'balena-semver';
import * as _ from 'lodash';
const { BadRequestError } = pinejsErrors;

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * Disallow hostapp downgrades, using the related release resource
	 */
	async PRERUN(args) {
		if (args.request.values.should_have_hostapp__release != null) {
			// First try to coerce the value to an integer for
			// moving forward
			args.request.custom.hostappRelease = parseInt(
				args.request.values.should_have_hostapp__release,
				10,
			);
			// But let's check we actually got a value
			// representing an integer
			if (!Number.isInteger(args.request.custom.hostappRelease)) {
				throw new BadRequestError('Expected an ID for the hostapp release');
			}

			// Ensure that we don't ever downgrade the hostapp
			// from it's current version
			await sbvrUtils
				.getAffectedIds(args)
				.then((ids) =>
					checkHostappReleaseUpgrades(
						args.api,
						ids,
						args.request.custom.hostappRelease,
					),
				);
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * When a device checks in with it's initial OS version, set the corresponding should_have_hostapp__release resource
	 * using its current reported version.
	 */
	async PRERUN(args) {
		if (args.request.values.os_version != null) {
			await sbvrUtils.getAffectedIds(args).then(async (ids) => {
				await setOSReleaseResource(
					args.api,
					ids,
					args.request.values.os_version,
				);
			});
		}
	},
});

async function setOSReleaseResource(
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	osVersion: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			// if the device already has an os_version, just bail.
			$filter: {
				id: { $in: deviceIds },
				os_version: null,
			},
			$select: ['id', 'is_of__device_type'],
		},
	});

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
		},
	});

	return Promise.all(
		_.map(devicesByDeviceType, async (affectedDevices, deviceType) => {
			const affectedDeviceIds = affectedDevices.map((d) => d.id);

			const [osRelease] = await getOSReleaseResource(
				api,
				osVersion,
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
					should_have_hostapp__release: osRelease.id,
				},
			});
		}),
	);
}

async function getOSReleaseResource(
	api: sbvrUtils.PinejsClient,
	osVersion: string,
	deviceTypeId: string,
) {
	return await api.get({
		resource: 'release',
		options: {
			$select: ['id', 'belongs_to__application'],
			$filter: {
				// TODO: maybe better to use release tags (to respect variant and version, though bleh)
				release_version: osVersion,
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							$and: [
								{
									a: {
										is_for__device_type: deviceTypeId,
									},
								},
								{
									a: {
										is_host: true,
									},
								},
							],
						},
					},
				},
			},
		},
	});
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
			$count: { $filter: { id: { $in: deviceIds }, os_version: null } },
		},
	});

	if (nullHostappCount === deviceIds.length) {
		return;
	}

	const newHostappRelease = await api.get({
		resource: 'release',
		id: newHostappReleaseId,
		options: {
			$select: 'release_version',
			$filter: {
				is_invalidated: false,
			},
		},
	});

	if (newHostappRelease == null) {
		throw new BadRequestError(
			`Could not find a hostapp release with this ID ${newHostappReleaseId}`,
		);
	}

	const newHostappVersion = newHostappRelease.release_version;

	const releases = await api.get({
		resource: 'release',
		options: {
			$select: 'release_version',
			$filter: {
				should_be_hostapp_on__device: {
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
	});

	for (const release of releases) {
		const oldVersion = release.release_version;
		if (semver.lt(newHostappVersion, oldVersion)) {
			throw new BadRequestError(
				`Attempt to downgrade hostapp, which is not allowed`,
			);
		}
	}
}
