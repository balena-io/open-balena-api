import * as semver from 'balena-semver';
import * as _ from 'lodash';
import {
	sbvrUtils,
	hooks,
	permissions,
	errors as pinejsErrors,
} from '@balena/pinejs';
import { Release } from '../../../balena-model';

const { BadRequestError } = pinejsErrors;

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * When a device checks in with it's initial supervisor version, set the corresponding should_be_managed_by__release resource
	 * using its current reported version.
	 */
	async PRERUN(args) {
		if (args.request.values.supervisor_version != null) {
			const ids = await sbvrUtils.getAffectedIds(args);
			const { api } = args;

			await setSupervisorResources(
				api,
				ids,
				args.request.values.supervisor_version,
			);
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * Disallow supervisor downgrades, using the related release resource
	 */
	async PRERUN(args) {
		if (args.request.values.should_be_managed_by__release != null) {
			// First try to coerce the value to an integer for
			// moving forward

			const releaseId = parseInt(
				args.request.values.should_be_managed_by__release,
				10,
			);

			// But let's check we actually got a value
			// representing an integer
			if (!Number.isInteger(releaseId)) {
				throw new BadRequestError('Expected an ID for the supervisor_release');
			}

			args.request.custom.supervisorRelease = releaseId;

			// Ensure that we don't ever downgrade the supervisor
			// from its current version
			const ids = await sbvrUtils.getAffectedIds(args);
			if (ids.length === 0) {
				return;
			}

			const release = await getRelease(args.api, releaseId);

			if (!release) {
				throw new BadRequestError(
					`Could not find a supervisor release with this ID ${releaseId}`,
				);
			}

			await checkSupervisorReleaseUpgrades(args.api, ids, release);
		}
	},
});

async function checkSupervisorReleaseUpgrades(
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	newSupervisorRelease: Partial<Release>,
): Promise<boolean> {
	const nullSupervisorCount = await api.get({
		resource: 'device',
		options: {
			$count: { $filter: { id: { $in: deviceIds }, supervisor_version: null } },
		},
	});

	if (nullSupervisorCount === deviceIds.length) {
		return false;
	}

	if (newSupervisorRelease.is_invalidated) {
		throw new BadRequestError(
			`Could not find a valid supervisor release with this ID ${newSupervisorRelease.id}`,
		);
	}

	const newSupervisorVersion = newSupervisorRelease.release_version;

	const oldReleases = await api.get({
		resource: 'release',
		options: {
			$select: 'release_version',
			$filter: {
				should_manage__device: {
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

	let doingUpgrade = false;

	for (const release of oldReleases) {
		const oldVersion = release.release_version;
		if (semver.gt(newSupervisorVersion, oldVersion)) {
			doingUpgrade = true;
		} else if (semver.lt(newSupervisorVersion, oldVersion)) {
			throw new BadRequestError(
				`Attempt to downgrade supervisor, which is not allowed`,
			);
		}
	}

	return doingUpgrade;
}

async function getRelease(
	api: sbvrUtils.PinejsClient,
	releaseId: number,
): Promise<Partial<Release> | undefined> {
	return await api.get({
		resource: 'release',
		id: releaseId,
		options: {
			$select: ['release_version', 'is_invalidated'],
		},
	});
}

async function getSupervisorReleaseResource(
	api: sbvrUtils.PinejsClient,
	supervisorVersion: string,
	archId: string,
) {
	return await api.get({
		resource: 'release',
		options: {
			$select: ['id', 'release_version'],
			// technically this is in violation of semver, but is required until logstreams go away
			$orderby: { release_version: 'desc' },
			$top: 1,
			$filter: {
				$or: [
					{ release_version: `v${supervisorVersion}` },
					{ release_version: `v${supervisorVersion}_logstream` },
					{ release_version: `v${supervisorVersion}_logstream2` },
				],
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								is_public: true,
								is_host: false,
								is_for__device_type: {
									$any: {
										$alias: 'dt',
										$expr: {
											dt: {
												is_of__cpu_architecture: {
													$any: {
														$alias: 'c',
														$expr: {
															c: {
																id: archId,
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
				},
			},
		},
	});
}

async function setSupervisorResources(
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	supervisorVersion: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			// if the device already has a supervisor_version, just bail.
			$filter: {
				id: { $in: deviceIds },
				supervisor_version: null,
			},
			$select: ['id'],
			$expand: {
				is_of__device_type: { $select: ['is_of__cpu_architecture', 'id'] },
			},
		},
	});

	if (devices.length === 0) {
		return;
	}

	const devicesByDeviceTypeArch = _.groupBy(devices, (d) => {
		return d.is_of__device_type[0].is_of__cpu_architecture.__id;
	});

	if (Object.keys(devicesByDeviceTypeArch).length === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
		},
	});

	await Promise.all(
		_.map(devicesByDeviceTypeArch, async (affectedDevices, deviceTypeArch) => {
			const affectedDeviceIds = affectedDevices.map((d) => d.id as number);

			const [supervisorRelease] = await getSupervisorReleaseResource(
				api,
				supervisorVersion,
				deviceTypeArch,
			);

			if (supervisorRelease?.id) {
				await setSupervisorRelease(
					rootApi,
					affectedDeviceIds,
					supervisorRelease.id,
				);
			}
		}),
	);
}

function setSupervisorRelease(
	rootApi: sbvrUtils.PinejsClient,
	deviceIds: number[],
	supervisorReleaseId: string,
) {
	return rootApi.patch({
		resource: 'device',
		options: {
			$filter: {
				id: { $in: deviceIds },
			},
		},
		body: {
			should_be_managed_by__release: supervisorReleaseId,
		},
	});
}
