import * as semver from 'balena-semver';
import {
	sbvrUtils,
	hooks,
	permissions,
	errors as pinejsErrors,
} from '@balena/pinejs';
import type { FilterObj } from 'pinejs-client-core';
import type { CpuArchitecture } from '../../../balena-model.js';

const { BadRequestError } = pinejsErrors;

hooks.addPureHook('POST', 'resin', 'device', {
	/**
	 * When the device's initial supervisor version is provided during registration, set the corresponding should_be_managed_by__release resource.
	 */
	async POSTPARSE({ request, api }) {
		if (
			typeof request.values.supervisor_version === 'string' &&
			typeof request.values.is_of__device_type === 'number'
		) {
			const [supervisorRelease] = await getSupervisorReleaseResource(
				api,
				request.values.supervisor_version,
				{
					is_supported_by__device_type: {
						$any: {
							$alias: 'dt',
							$expr: {
								dt: {
									id: request.values.is_of__device_type,
								},
							},
						},
					},
				},
			);

			if (supervisorRelease == null) {
				return;
			}
			// We are not using setSupervisorReleaseResource in a POSTRUN, since that only sets
			// the supervisor release FK to device that have no supervisor_release set, and by the
			// that POSTRUN for a POST, the device would already have a supervisor_release set.
			request.values.should_be_managed_by__release = supervisorRelease.id;
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * When a device checks in with it's initial supervisor version, set the corresponding should_be_managed_by__release resource
	 * using its current reported version.
	 */
	async PRERUN(args) {
		if (args.request.values.supervisor_version != null) {
			const ids = await sbvrUtils.getAffectedIds(args);
			await setSupervisorReleaseResource(
				args.api,
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
			args.request.custom.supervisorRelease = parseInt(
				args.request.values.should_be_managed_by__release,
				10,
			);
			// But let's check we actually got a value
			// representing an integer
			if (!Number.isInteger(args.request.custom.supervisorRelease)) {
				throw new BadRequestError('Expected an ID for the supervisor_release');
			}

			// Ensure that we don't ever downgrade the supervisor
			// from its current version
			const ids = await sbvrUtils.getAffectedIds(args);
			await checkSupervisorReleaseUpgrades(
				args.api,
				ids,
				args.request.custom.supervisorRelease,
			);
		}
	},
});

async function checkSupervisorReleaseUpgrades(
	api: typeof sbvrUtils.api.resin,
	deviceIds: number[],
	newSupervisorReleaseId: number,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const nullSupervisorCount = await api.get({
		resource: 'device',
		options: {
			$count: { $filter: { id: { $in: deviceIds }, supervisor_version: null } },
		},
	});

	if (nullSupervisorCount === deviceIds.length) {
		return;
	}

	const newSupervisorRelease = await api.get({
		resource: 'release',
		id: newSupervisorReleaseId,
		options: {
			$select: 'raw_version',
			$filter: {
				is_invalidated: false,
			},
		},
	});

	if (newSupervisorRelease == null) {
		throw new BadRequestError(
			`Could not find a supervisor release with this ID ${newSupervisorReleaseId}`,
		);
	}

	const newSupervisorVersion = newSupervisorRelease.raw_version;

	const releases = await api.get({
		resource: 'release',
		options: {
			$select: 'raw_version',
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

	for (const release of releases) {
		const oldVersion = release.raw_version;
		if (semver.lt(newSupervisorVersion, oldVersion)) {
			throw new BadRequestError(
				`Attempt to downgrade supervisor, which is not allowed`,
			);
		}
	}
}

async function getSupervisorReleaseResource(
	api: typeof sbvrUtils.api.resin,
	supervisorVersion: string,
	cpuArchFilter: number | FilterObj<CpuArchitecture['Read']>,
) {
	return await api.get({
		resource: 'release',
		options: {
			$top: 1,
			$select: 'id',
			$filter: {
				semver: supervisorVersion,
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							$and: [
								{ a: { slug: { $startswith: 'balena_os/' } } },
								{ a: { slug: { $endswith: '-supervisor' } } },
							],
							a: {
								is_public: true,
								is_host: false,
								is_for__device_type: {
									$any: {
										$alias: 'dt',
										$expr: {
											dt: {
												is_of__cpu_architecture:
													typeof cpuArchFilter === 'number'
														? cpuArchFilter
														: {
																$any: {
																	$alias: 'c',
																	$expr: {
																		c: cpuArchFilter,
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
			$orderby: { revision: 'desc' },
		},
	});
}

async function setSupervisorReleaseResource(
	api: typeof sbvrUtils.api.resin,
	deviceIds: number[],
	supervisorVersion: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			$select: ['id'],
			$expand: {
				is_of__device_type: { $select: ['is_of__cpu_architecture'] },
			},
			// if the device already has a supervisor_version, just bail.
			$filter: {
				id: { $in: deviceIds },
				supervisor_version: null,
			},
		},
	} as const);

	if (devices.length === 0) {
		return;
	}

	const devicesByCpuArchId = Map.groupBy(devices, (d) => {
		return d.is_of__device_type[0].is_of__cpu_architecture.__id;
	});

	if (devicesByCpuArchId.size === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
			tx: api.passthrough.tx,
		},
	});

	return Promise.all(
		Array.from(devicesByCpuArchId, async ([cpuArchId, affectedDevices]) => {
			const affectedDeviceIds = affectedDevices.map((d) => d.id);

			const [supervisorRelease] = await getSupervisorReleaseResource(
				api,
				supervisorVersion,
				cpuArchId,
			);

			if (supervisorRelease == null) {
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
					should_be_managed_by__release: supervisorRelease.id,
				},
			});
		}),
	);
}
