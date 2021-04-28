import * as _ from 'lodash';
import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';
import type {
	Device,
	PickDeferred,
	Service,
	ServiceInstall,
} from '../../../balena-model';

const actOnReleaseServiceInstalls = async (
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	releaseFilter: Filter,
	handler: (
		api: sbvrUtils.PinejsClient,
		deviceIds: number[],
		serviceIds: number[],
	) => Promise<void>,
): Promise<void> => {
	if (deviceIds.length === 0) {
		return;
	}

	const services = (await api.get({
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
	})) as Array<Pick<Service, 'id'>>;
	if (services.length === 0) {
		return;
	}
	const serviceIds = services.map(({ id }) => id);

	await handler(api, deviceIds, serviceIds);
};

const actOnAppServiceInstalls = async (
	api: sbvrUtils.PinejsClient,
	appIds: number[],
	deviceIds: number[],
	handler: (
		api: sbvrUtils.PinejsClient,
		deviceIds: number[],
		serviceIds: number[],
	) => Promise<void>,
): Promise<void> =>
	actOnReleaseServiceInstalls(
		api,
		deviceIds,
		{
			should_be_running_on__application: {
				$any: {
					$alias: 'a',
					$expr: { a: { id: { $in: appIds } } },
				},
			},
		},
		handler,
	);

const serviceInstallCreationHandler = async (
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	serviceIds: number[],
) => {
	const serviceInstalls = (await api.get({
		resource: 'service_install',
		options: {
			$select: ['device', 'installs__service'],
			$filter: {
				device: { $in: deviceIds },
				installs__service: { $in: serviceIds },
			},
		},
	})) as Array<PickDeferred<ServiceInstall, 'device' | 'installs__service'>>;
	const serviceInstallsByDevice = _.groupBy(
		serviceInstalls,
		(si) => si.device.__id as number,
	);

	await Promise.all(
		deviceIds.map(async (deviceId) => {
			const existingServiceIds: number[] = _.map(
				serviceInstallsByDevice[deviceId],
				(si) => si.installs__service.__id,
			);
			const deviceServiceIds = _.difference(serviceIds, existingServiceIds);
			await Promise.all(
				deviceServiceIds.map(async (serviceId) => {
					// Create a service_install for this pair of service and device
					await api.post({
						resource: 'service_install',
						body: {
							device: deviceId,
							installs__service: serviceId,
						},
						options: { returnResource: false },
					});
				}),
			);
		}),
	);
};

const createReleaseServiceInstalls = (
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	releaseFilter: Filter,
): Promise<void> =>
	actOnReleaseServiceInstalls(
		api,
		deviceIds,
		releaseFilter,
		serviceInstallCreationHandler,
	);

const createAppServiceInstalls = (
	api: sbvrUtils.PinejsClient,
	appId: number,
	deviceIds: number[],
) =>
	actOnAppServiceInstalls(
		api,
		[appId],
		deviceIds,
		serviceInstallCreationHandler,
	);

const deleteServiceInstallsForCurrentApp = (
	api: sbvrUtils.PinejsClient,
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
	POSTRUN: async ({ api, request }) => {
		const affectedIds = request.affectedIds!;
		if (
			request.values.should_be_running__release != null &&
			affectedIds.length !== 0
		) {
			// Ensure that every device of the app we've just pinned, that is not itself pinned, has the necessary service install entries
			const devices = (await api.get({
				resource: 'device',
				options: {
					$select: 'id',
					$filter: {
						belongs_to__application: { $in: affectedIds },
						should_be_running__release: null,
					},
				},
			})) as Array<Pick<Device, 'id'>>;

			await createReleaseServiceInstalls(
				api,
				devices.map(({ id }) => id),
				{
					id: request.values.should_be_running__release,
				},
			);
		}
	},
});

hooks.addPureHook('POST', 'resin', 'device', {
	POSTRUN: async ({ request, api, tx, result: deviceId }) => {
		// Don't try to add service installs if the device wasn't created
		if (deviceId == null) {
			return;
		}

		const rootApi = api.clone({ passthrough: { tx, req: permissions.root } });

		await createAppServiceInstalls(
			rootApi,
			request.values.belongs_to__application,
			[deviceId],
		);
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const affectedIds = await sbvrUtils.getAffectedIds(args);

		// We need to delete all service_install resources for the current app of these devices
		// and create new ones for the new application (if the device is moving application)
		if (
			args.request.values.belongs_to__application != null &&
			affectedIds.length !== 0
		) {
			await deleteServiceInstallsForCurrentApp(args.api, affectedIds);
			await createAppServiceInstalls(
				args.api,
				args.request.values.belongs_to__application,
				affectedIds,
			);
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTRUN: async ({ api, request }) => {
		const affectedIds = request.affectedIds!;
		if (
			request.values.should_be_running__release !== undefined &&
			affectedIds.length !== 0
		) {
			// If the device was preloaded, and then pinned, service_installs do not exist
			// for this device+release combination. We need to create these
			if (request.values.should_be_running__release != null) {
				await createReleaseServiceInstalls(api, affectedIds, {
					id: request.values.should_be_running__release,
				});
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
						),
					),
				);
			}
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTRUN: async ({ api, request }) => {
		const affectedIds = request.affectedIds!;

		// Create supervisor service installs when the supervisor is pinned
		if (
			request.values.should_be_managed_by__release != null &&
			affectedIds.length !== 0
		) {
			await createReleaseServiceInstalls(api, affectedIds, {
				id: request.values.should_be_managed_by__release,
			});
		}
	},
});
