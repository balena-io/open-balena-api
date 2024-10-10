import { tasks, sbvrUtils, permissions } from '@balena/pinejs';
import { randomUUID } from 'node:crypto';

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

// TODO: make me an env var :)
const MAX_JOB_TIME_MS = 30 * 1000;

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

	// TODO: There must be a way to do a single query for it...

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

	const devicesToAddServiceInstalls = await api.resin.get({
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
	} as const);

	// hmmm should we really go one device at a time or Promise.all?
	// This is already batched at one level, does it make sense to batch it again?
	const tx = await sbvrUtils.db.transaction();
	const remainingDevices = new Set(devices);
	let totalSiCreated = 0;
	for (const device of devicesToAddServiceInstalls) {
		// TODO maybe we need to do a improved diff here?
		// e.g keep the mean device time and this become
		// if (Date.now() - startTime > MAX_JOB_TIME_MS - meanDeviceTime)
		// but I am probably overthinking it
		if (Date.now() - startTime > MAX_JOB_TIME_MS) {
			// TODO: better error handling
			await api.tasks.post({
				resource: 'task',
				passthrough: { req: permissions.root, tx },
				body: {
					key: randomUUID(),
					is_executed_by__handler: 'create_service_installs',
					is_executed_with__parameter_set: {
						devices: Array.from(remainingDevices),
					} satisfies CreateServiceInstallsTaskParams,
				},
			});
			await tx.end();

			console.info(
				'[service-install-task] Task took too long. Created a new task for the remaining devices',
			);
			return totalSiCreated;
		}

		// Use existingServiceIds as a Set for faster lookups on the follow up filter
		const existingServiceIds = new Set(
			device.service_install.map((si) => si.installs__service.__id),
		);
		const deviceServiceIds = serviceIds.filter(
			(sid) => !existingServiceIds.has(sid),
		);

		// TODO, we need to handle in case it fails.
		// Maybe something smart is that if a specific device fails
		// we create a new task with only the failures
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

	await tx.end();
	return totalSiCreated;
};
