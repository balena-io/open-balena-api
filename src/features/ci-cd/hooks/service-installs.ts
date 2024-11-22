import _ from 'lodash';
import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import type { Filter, FilterObj } from 'pinejs-client-core';
import type { Device, Release } from '../../../balena-model.js';
import type { CreateServiceInstallsTaskParams } from '../tasks/service-installs.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_CREATE_SERVICE_INSTALLS_BATCH_SIZE,
	ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED,
	ASYNC_TASKS_ENABLED,
} from '../../../lib/config.js';

const createServiceInstallsAsync = async (
	api: typeof sbvrUtils.api.resin,
	deviceFilterOrIds: number[] | FilterObj<Device['Read']>,
	tx: Tx,
): Promise<void> => {
	const deviceIds = Array.isArray(deviceFilterOrIds)
		? deviceFilterOrIds
		: (
				await api.get({
					resource: 'device',
					options: {
						$select: 'id',
						$filter: deviceFilterOrIds,
					},
				})
			).map(({ id }) => id);

	await Promise.all(
		_.chunk(deviceIds, ASYNC_TASK_CREATE_SERVICE_INSTALLS_BATCH_SIZE).map(
			async (deviceBatch) => {
				return await sbvrUtils.api.tasks.post({
					resource: 'task',
					passthrough: { req: permissions.root, tx },
					body: {
						is_executed_by__handler: 'create_service_installs',
						is_executed_with__parameter_set: {
							devices: deviceBatch,
						} satisfies CreateServiceInstallsTaskParams,
						attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
					},
				});
			},
		),
	);
};

const createReleaseServiceInstalls = async (
	api: typeof sbvrUtils.api.resin,
	deviceFilterOrIds: number[] | FilterObj<Device['Read']>,
	releaseFilter: Filter<Release['Read']>,
	tx: Tx,
): Promise<void> => {
	if (Array.isArray(deviceFilterOrIds) && deviceFilterOrIds.length === 0) {
		return;
	}

	if (ASYNC_TASKS_ENABLED && ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED) {
		await createServiceInstallsAsync(api, deviceFilterOrIds, tx);
		return;
	}

	const services = await api.get({
		resource: 'service',
		options: {
			$select: 'id',
			$filter: {
				is_built_by__image: {
					$any: {
						$alias: 'i',
						$expr: {
							i: {
								is_part_of__release: {
									$any: {
										$alias: 'ipr',
										$expr: {
											ipr: {
												release: {
													$any: {
														$alias: 'r',
														$expr: { r: releaseFilter },
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
	if (services.length === 0) {
		return;
	}
	const serviceIds = services.map(({ id }) => id);

	const missingServiceFilters = serviceIds.map((serviceId) => ({
		$not: {
			service_install: {
				$any: {
					$alias: 'si',
					$expr: {
						si: {
							installs__service: serviceId,
						},
					},
				},
			},
		},
	}));

	const devicesToAddServiceInstalls = await api.get({
		resource: 'device',
		options: {
			$select: 'id',
			$expand: {
				service_install: {
					$select: 'installs__service',
					$filter: {
						installs__service: { $in: serviceIds },
					},
				},
			},
			$filter: {
				// Pass the device filters instead of IDs, since a using $in errors with `code: '08P01'` for more than 66k IDs.
				...(Array.isArray(deviceFilterOrIds)
					? { id: { $in: deviceFilterOrIds } }
					: deviceFilterOrIds),
				// TODO: Once Pine support it, change this with a filtered-count filter like:
				// $filter=... service_install/$filter(installs__service $in (...serviceIds))/$count lt ${serviceIds.length}
				// See: http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#sec_RequestingtheNumberofItemsinaCollect
				...(missingServiceFilters.length === 1
					? missingServiceFilters[0]
					: {
							$or: missingServiceFilters,
						}),
			},
		},
	} as const);

	await Promise.all(
		devicesToAddServiceInstalls.map(async (device) => {
			const existingServiceIds = device.service_install.map(
				(si) => si.installs__service.__id,
			);
			const deviceServiceIds = _.difference(serviceIds, existingServiceIds);
			await Promise.all(
				deviceServiceIds.map(async (serviceId) => {
					// Create a service_install for this pair of service and device
					await api.post({
						resource: 'service_install',
						body: {
							device: device.id,
							installs__service: serviceId,
						},
						options: { returnResource: false },
					});
				}),
			);
		}),
	);
};

const createAppServiceInstalls = async (
	api: typeof sbvrUtils.api.resin,
	appId: number,
	deviceIds: number[],
	tx: Tx,
): Promise<void> =>
	createReleaseServiceInstalls(
		api,
		deviceIds,
		{
			should_be_running_on__application: {
				$any: {
					$alias: 'a',
					$expr: { a: { id: appId } },
				},
			},
		},
		tx,
	);

const deleteServiceInstallsForCurrentApp = (
	api: typeof sbvrUtils.api.resin,
	newAppId: number,
	deviceIds: number[],
) =>
	api.delete({
		resource: 'service_install',
		options: {
			$filter: {
				device: { $in: deviceIds },
				installs__service: {
					$any: {
						$alias: 's',
						$expr: {
							s: {
								application: {
									// Don't bother deleting service installs for the app we're moving to
									$ne: newAppId,
									$any: {
										$alias: 'a',
										$expr: {
											a: {
												owns__device: {
													$any: {
														$alias: 'd',
														$expr: { d: { id: { $in: deviceIds } } },
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

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: async ({ api, request, tx }) => {
		const affectedIds = request.affectedIds!;
		if (
			request.values.should_be_running__release != null &&
			affectedIds.length !== 0
		) {
			// Ensure that every device of the app we've just pinned, that is not itself pinned, has the necessary service install entries.
			await createReleaseServiceInstalls(
				api,
				{
					belongs_to__application: { $in: affectedIds },
					is_pinned_on__release: null,
				},
				{
					id: request.values.should_be_running__release,
				},
				tx,
			);
		}
	},
});

hooks.addPureHook('POST', 'resin', 'device', {
	POSTRUN: async ({ request, api, tx, result: deviceId }) => {
		// Don't try to add service installs if the device wasn't created
		if (typeof deviceId !== 'number') {
			return;
		}

		const rootApi = api.clone({ passthrough: { tx, req: permissions.root } });

		const app = request.values.belongs_to__application;
		if (app != null) {
			await createAppServiceInstalls(rootApi, app, [deviceId], tx);
		}

		const release = request.values.is_pinned_on__release;
		if (release != null) {
			await createReleaseServiceInstalls(
				api,
				[deviceId],
				{
					id: release,
				},
				tx,
			);
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		// We need to delete all service_install resources for the current app of these devices
		// and create new ones for the new application (if the device is moving application)
		const newAppId = args.request.values.belongs_to__application;
		if (newAppId == null) {
			return;
		}
		const affectedIds = await sbvrUtils.getAffectedIds(args);
		if (affectedIds.length !== 0) {
			await deleteServiceInstallsForCurrentApp(args.api, newAppId, affectedIds);
		}
	},
	POSTRUN: async ({ api, request, tx }) => {
		const affectedIds = request.affectedIds!;
		if (affectedIds.length === 0) {
			return;
		}
		const newAppId = request.values.belongs_to__application;
		if (newAppId != null) {
			await createAppServiceInstalls(api, newAppId, affectedIds, tx);
		}
		if (request.values.is_pinned_on__release !== undefined) {
			// If the device was preloaded, and then pinned, service_installs do not exist
			// for this device+release combination. We need to create these
			if (request.values.is_pinned_on__release != null) {
				await createReleaseServiceInstalls(
					api,
					affectedIds,
					{
						id: request.values.is_pinned_on__release,
					},
					tx,
				);
			} else {
				const devices = (await api.get({
					resource: 'device',
					options: {
						$select: ['id', 'belongs_to__application'],
						$filter: {
							id: { $in: affectedIds },
						},
					},
				})) as Array<{
					id: number;
					belongs_to__application: { __id: number };
				}>;
				const devicesByApp = _.groupBy(
					devices,
					(d) => d.belongs_to__application.__id,
				);
				await Promise.all(
					Object.keys(devicesByApp).map((appId) =>
						createAppServiceInstalls(
							api,
							devicesByApp[appId][0].belongs_to__application.__id,
							devicesByApp[appId].map((d) => d.id),
							tx,
						),
					),
				);
			}
		}
	},
});

const addSystemAppServiceInstallHooks = (
	fieldName: 'should_be_managed_by__release' | 'should_be_operated_by__release',
) => {
	hooks.addPureHook('POST', 'resin', 'device', {
		POSTRUN: async ({ request, api, tx, result: deviceId }) => {
			// Don't try to add service installs if the device wasn't created
			if (typeof deviceId !== 'number') {
				return;
			}

			const releaseId = request.values[fieldName];
			// Create supervisor/hostApp service installs when the supervisor/hostApp is pinned on device creation
			if (releaseId != null) {
				const rootApi = api.clone({
					passthrough: { tx, req: permissions.root },
				});
				await createReleaseServiceInstalls(
					rootApi,
					[deviceId],
					{
						id: releaseId,
					},
					tx,
				);
			}
		},
	});

	hooks.addPureHook('PATCH', 'resin', 'device', {
		POSTRUN: async ({ api, request, tx }) => {
			const affectedIds = request.affectedIds!;
			const releaseId = request.values[fieldName];
			// Create supervisor/hostApp service installs when the supervisor/hostApp is pinned on device update
			if (releaseId != null && affectedIds.length !== 0) {
				await createReleaseServiceInstalls(
					api,
					affectedIds,
					{
						id: releaseId,
					},
					tx,
				);
			}
		},
	});
};

for (const fieldName of [
	'should_be_managed_by__release',
	'should_be_operated_by__release',
] as const) {
	addSystemAppServiceInstallHooks(fieldName);
}
