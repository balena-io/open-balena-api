import * as _ from 'lodash';
import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';
import type { Device } from '../../../balena-model';

const createReleaseServiceInstalls = async (
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	releaseFilter: Filter,
): Promise<void> => {
	await Promise.all(
		deviceIds.map(async (deviceId) => {
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
						// Filter out any services which do have a service install attached
						$not: {
							service_install: {
								$any: {
									$alias: 'si',
									$expr: {
										si: { device: deviceId },
									},
								},
							},
						},
					},
				},
			});
			await Promise.all(
				services.map(async (service) => {
					// Create a service_install for this pair of service and device
					await api.post({
						resource: 'service_install',
						body: {
							device: deviceId,
							installs__service: service.id,
						},
						options: { returnResource: false },
					});
				}),
			);
		}),
	);
};

const createAppServiceInstalls = async (
	api: sbvrUtils.PinejsClient,
	appId: number,
	deviceIds: number[],
): Promise<void> =>
	createReleaseServiceInstalls(api, deviceIds, {
		should_be_running_on__application: {
			$any: {
				$alias: 'a',
				$expr: { a: { id: appId } },
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
			const appsToUpdate = await api.get({
				resource: 'application',
				options: {
					$select: 'owns__device',
					$expand: {
						owns__device: {
							$select: 'id',
							$filter: {
								should_be_running__release: null,
							},
						},
						owns__release: {
							$select: 'contains__image',
							$expand: {
								contains__image: {
									$select: 'image',
									$expand: {
										image: {
											$select: 'is_a_build_of__service',
											$expand: {
												is_a_build_of__service: {
													$select: 'id',
												},
											},
										},
									},
								},
							},
							$filter: {
								id: request.values.should_be_running__release,
							},
						},
					},
					$filter: {
						id: { $in: affectedIds },
					},
				},
			});
			if (!appsToUpdate.length) {
				return;
			}

			await Promise.all(
				appsToUpdate.map(async (app) => {
					const [release] = app.owns__release;
					if (release == null) {
						return;
					}

					const deviceIds: number[] = app.owns__device.map(
						(device: Pick<Device, 'id'>) => device.id,
					);
					const serviceIds: number[] = release.contains__image.map(
						(ipr: AnyObject) => ipr.image[0].is_a_build_of__service[0].id,
					);
					if (deviceIds.length === 0 || serviceIds.length === 0) {
						return;
					}
					const serviceInstalls = await api.get({
						resource: 'service_install',
						options: {
							$select: ['device', 'installs__service'],
							$filter: {
								device: { $in: deviceIds },
								installs__service: { $in: serviceIds },
							},
						},
					});
					const serviceInstallsByDevice = _.groupBy(
						serviceInstalls,
						(si) => si.device.__id as number,
					);
					await Promise.all(
						deviceIds.map(async (deviceId) => {
							const existingServiceIds: number[] =
								serviceInstallsByDevice[deviceId]?.map(
									(si) => si.installs__service.__id,
								) ?? [];
							const deviceServiceIds = _.difference(
								serviceIds,
								existingServiceIds,
							);
							await Promise.all(
								deviceServiceIds.map(async (serviceId) => {
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
				}),
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
	POSTRUN: async (args) => {
		const affectedIds = args.request.affectedIds!;

		// We need to delete all service_install resources for the current device and
		// create new ones for the new application (if the device is moving application)
		if (
			args.request.values.belongs_to__application != null &&
			affectedIds.length !== 0
		) {
			await args.api.delete({
				resource: 'service_install',
				options: {
					$filter: {
						device: { $in: affectedIds },
					},
				},
			});
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
