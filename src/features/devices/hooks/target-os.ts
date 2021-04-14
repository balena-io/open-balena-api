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
		if (args.request.values.is_initialized_by__release != null) {
			// First try to coerce the value to an integer for
			// moving forward
			args.request.custom.hostappRelease = parseInt(
				args.request.values.is_initialized_by__release,
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
	 * When a device checks in with it's initial OS version, set the corresponding is_initialized_by__release resource
	 * using its current reported version.
	 */
	async PRERUN(args) {
		if (args.request.values.os_version != null) {
			await sbvrUtils.getAffectedIds(args).then(async (ids) => {
				await setOSReleaseResource(
					args.api,
					ids,
					args.request.values.os_version,
					args.request.values.os_variant,
				);
			});
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
					is_initialized_by__release: osRelease.id,
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
				$and: [
					{
						release_tag: {
							$any: {
								$alias: 'rt',
								$expr: {
									rt: {
										// TODO: probably better to move all this string munging to a normalization
										// function. also, maybe we care about devices provisioning with `resinOS` in
										// the name, but probably we can just treat those as so old it doesn't really
										// matter.
										value: osVersion.replace('balenaOS ', ''),
										tag_key: 'version',
									},
								},
							},
						},
					},
					{
						release_tag: {
							$any: {
								$alias: 'rt',
								$expr: {
									rt: {
										// TODO: probably better to move all this string munging to a normalization
										// function.
										value: osVariant === 'prod' ? 'production' : 'development',
										tag_key: 'variant',
									},
								},
							},
						},
					},
				],
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

	// TODO: this should use tags
	const newHostappVersion = newHostappRelease.release_version;

	const releases = await api.get({
		resource: 'release',
		options: {
			$select: 'release_version',
			$filter: {
				initializes__device: {
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
