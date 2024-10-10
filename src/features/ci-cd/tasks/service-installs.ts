import { tasks, sbvrUtils, permissions } from '@balena/pinejs';
import type { FromSchema } from 'json-schema-to-ts';
import _ from 'lodash';

const schema = {
	type: 'object',
	properties: {
		devicesToAddServiceInstalls: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: {
						type: 'number',
					},
					service_install: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								installs__service: {
									type: 'object',
									properties: {
										__id: {
											type: 'number',
										},
									},
									required: ['__id'],
								},
							},
							required: ['installs__service'],
						},
					},
				},
				required: ['id', 'service_install'],
			},
		},
		serviceIds: {
			type: 'array',
			items: {
				type: 'number',
			},
		},
	},
	required: ['devicesToAddServiceInstalls', 'serviceIds'],
} as const;

export type CreateDeviceParams = FromSchema<typeof schema>;

tasks.addTaskHandler(
	'create_service_installs',
	async (options) => {
		const { devicesToAddServiceInstalls, serviceIds } =
			options.params as CreateDeviceParams;

		try {
			await Promise.all(
				devicesToAddServiceInstalls.map(async (device) => {
					const existingServiceIds = device.service_install.map(
						(si) => si.installs__service.__id,
					);
					const deviceServiceIds = _.difference(serviceIds, existingServiceIds);
					await Promise.all(
						deviceServiceIds.map(async (serviceId) => {
							// Create a service_install for this pair of service and device
							await sbvrUtils.api.resin.post({
								passthrough: { req: permissions.root },
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
		} catch (error) {
			console.error('Error', error);
			return {
				status: 'failed',
			};
		}

		return {
			status: 'succeeded',
		};
	},
	schema,
);
