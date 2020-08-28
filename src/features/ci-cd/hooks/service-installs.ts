import * as _ from 'lodash';
import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';

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
