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
): Promise<void> => {
	await createReleaseServiceInstalls(api, deviceIds, {
		should_be_running_on__application: {
			$any: {
				$alias: 'a',
				$expr: { a: { id: appId } },
			},
		},
	});
};

hooks.addPureHook('POST', 'resin', 'device_application', {
	POSTRUN: async ({ request, api, tx, result: deviceAppId }) => {
		// Don't try to add service installs if the device app wasn't created
		if (deviceAppId == null) {
			return;
		}

		const rootApi = api.clone({ passthrough: { tx, req: permissions.root } });

		await createAppServiceInstalls(
			rootApi,
			request.values.belongs_to__application,
			[request.values.device],
		);
	},
});

hooks.addPureHook('PATCH', 'resin', 'device_application', {
	POSTRUN: async ({ api, request }) => {
		const affectedIds = request.affectedIds!;
		if (
			affectedIds.length === 0 ||
			request.values.should_be_running__release === undefined
		) {
			return;
		}

		const deviceApps = (await api.get({
			resource: 'device_application',
			options: {
				$select: ['device', 'belongs_to__application'],
				$filter: {
					id: {
						$in: affectedIds,
					},
				},
			},
		})) as Array<{
			device: { __id: number };
			belongs_to__application: { __id: number };
		}>;

		if (deviceApps.length === 0) {
			return;
		}

		const deviceIds = deviceApps.map(({ device }) => device.__id);

		// If the device was preloaded, and then pinned, service_installs do not exist
		// for this device+release combination. We need to create these
		if (request.values.should_be_running__release != null) {
			await createReleaseServiceInstalls(api, deviceIds, {
				id: request.values.should_be_running__release,
			});
		} else {
			const devicesByApp = _.groupBy(
				deviceApps,
				(d) => d.belongs_to__application.__id,
			);
			await Promise.all(
				Object.keys(devicesByApp).map(async (groupId) => {
					const appId = devicesByApp[groupId][0]?.belongs_to__application.__id;
					if (appId == null) {
						return;
					}
					await createAppServiceInstalls(
						api,
						appId,
						devicesByApp[groupId].map((d) => d.device.__id),
					);
				}),
			);
		}
	},
});
