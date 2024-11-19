import { tasks, sbvrUtils, permissions } from '@balena/pinejs';
import _ from 'lodash';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_CREATE_SERVICE_INSTALLS_MAX_TIME_MS,
} from '../../../lib/config.js';

const schema = {
	type: 'object',
	properties: {
		devices: {
			type: 'array',
			items: { type: 'number' },
		},
	},
	required: ['devices'],
};

const { api } = sbvrUtils;

export type CreateServiceInstallsTaskParams = {
	devices: number[];
};

tasks.addTaskHandler(
	'create_service_installs',
	async (options) => {
		try {
			const totalSiCreated = await createServiceInstalls(
				options.params as CreateServiceInstallsTaskParams,
			);
			console.info(
				`[service-install-task] Created ${totalSiCreated} service installs`,
			);
			return {
				status: 'succeeded',
			};
		} catch (e) {
			console.error(
				`[service-install-task] Error creating service installs: ${e}`,
			);
			return {
				error: `${e}`,
				status: 'failed',
			};
		}
	},
	schema,
);

const createServiceInstalls = async ({
	devices,
}: CreateServiceInstallsTaskParams) => {
	const startTime = Date.now();

	const releaseExpand = {
		$select: 'id',
		$expand: {
			contains__image: {
				$select: 'id',
				$expand: {
					image: {
						$select: 'is_a_build_of__service',
					},
				},
			},
		},
	} as const;

	const deviceWithServices = await api.resin.get({
		resource: 'device',
		passthrough: { req: permissions.rootRead },
		options: {
			$select: 'id',
			$expand: {
				should_be_running__release: releaseExpand,
				should_be_managed_by__release: releaseExpand,
				should_be_operated_by__release: releaseExpand,
			},
			$filter: {
				id: { $in: devices },
			},
		} as const,
	});

	const serviceIds = [
		...new Set(
			deviceWithServices.flatMap((device) =>
				[
					...device.should_be_running__release,
					...device.should_be_managed_by__release,
					...device.should_be_operated_by__release,
				].flatMap((release) =>
					release.contains__image.flatMap((image) =>
						image.image.map((img) => img.is_a_build_of__service.__id),
					),
				),
			),
		),
	];

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

	if (missingServiceFilters.length === 0) {
		console.info('[service-install-task] No service installs to create');
		return 0;
	}

	const devicesToAddServiceInstalls = (
		await api.resin.get({
			resource: 'device',
			passthrough: { req: permissions.rootRead },
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
					id: { $in: devices },
					...(missingServiceFilters.length === 1
						? missingServiceFilters[0]
						: {
								$or: missingServiceFilters,
							}),
				},
			},
		} as const)
	).map((device) => {
		// Transform the device to the simpler object we will need later which is smaller
		// and will allow the larger version to be garbage collected sooner
		return {
			id: device.id,
			serviceInstalls: device.service_install.map(
				(si) => si.installs__service.__id,
			),
		};
	});

	// This is already batched at one level, does it make sense to batch it again?
	const remainingDevices = new Set(devices);
	let totalSiCreated = 0;

	return await sbvrUtils.db.transaction(async (tx) => {
		for (const device of devicesToAddServiceInstalls) {
			if (
				Date.now() - startTime >
				ASYNC_TASK_CREATE_SERVICE_INSTALLS_MAX_TIME_MS
			) {
				await api.tasks.post({
					resource: 'task',
					passthrough: { req: permissions.root, tx },
					body: {
						is_executed_by__handler: 'create_service_installs',
						is_executed_with__parameter_set: {
							devices: Array.from(remainingDevices),
						} satisfies CreateServiceInstallsTaskParams,
						attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
					},
				});

				console.info(
					'[service-install-task] Task took too long. Created a new task for the remaining devices',
				);
				return totalSiCreated;
			}

			// Use existingServiceIds as a Set for faster lookups on the follow up filter
			const existingServiceIds = device.serviceInstalls;
			const deviceServiceIds = _.difference(serviceIds, existingServiceIds);

			await Promise.all(
				deviceServiceIds.map(async (serviceId) => {
					// Create a service_install for this pair of service and device
					await api.resin.post({
						resource: 'service_install',
						passthrough: { req: permissions.root, tx },
						body: {
							device: device.id,
							installs__service: serviceId,
						},
						options: { returnResource: false },
					});
				}),
			);

			totalSiCreated += deviceServiceIds.length;
			remainingDevices.delete(device.id);
		}
		return totalSiCreated;
	});
};
