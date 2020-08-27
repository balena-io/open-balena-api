import * as _ from 'lodash';
import { TypedError } from 'typed-error';

import { sbvrUtils, hooks, permissions, errors } from '@balena/pinejs';

import {
	checkDevicesCanBeInApplication,
	checkDevicesCanHaveDeviceURL,
} from '../../features/application-types/application-types';

const { BadRequestError } = errors;

export class InaccessibleAppError extends TypedError {
	constructor(
		message = "Application doesn't exist or you have no access to it.",
	) {
		super(message);
	}
}

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { api, request } = args;
		const waitPromises: Array<PromiseLike<any>> = [];

		if (request.values.belongs_to__application != null) {
			waitPromises.push(
				api
					.get({
						resource: 'application',
						id: request.values.belongs_to__application,
						options: {
							$select: 'id',
						},
					})
					.catch(() => {
						throw new InaccessibleAppError();
					})
					.then(async (app) => {
						if (app == null) {
							throw new InaccessibleAppError();
						}

						const deviceIds = await sbvrUtils.getAffectedIds(args);
						if (deviceIds.length === 0) {
							return;
						}
						// and get the devices being affected and store them for the POSTRUN...
						const devices = (await args.api.get({
							resource: 'device',
							options: {
								$select: 'id',
								$filter: {
									id: {
										$in: deviceIds,
									},
									belongs_to__application: {
										$ne: args.request.values.belongs_to__application,
									},
								},
							},
						})) as Array<{ id: number }>;

						request.custom.movedDevices = devices.map((device) => device.id);
					}),
			);
		}

		// check the release is valid for the devices affected...
		if (request.values.should_be_running__release != null) {
			waitPromises.push(
				sbvrUtils.getAffectedIds(args).then(async (deviceIds) => {
					if (deviceIds.length === 0) {
						return;
					}
					const release = await args.api.get({
						resource: 'release',
						id: request.values.should_be_running__release,
						options: {
							$select: ['id'],
							$filter: {
								status: 'success',
								belongs_to__application: {
									$any: {
										$alias: 'a',
										$expr: {
											a: {
												owns__device: {
													$any: {
														$alias: 'd',
														$expr: {
															d: {
																id: { $in: deviceIds },
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

					if (release == null) {
						throw new BadRequestError('Release is not valid for this device');
					}
				}),
			);
		}

		if (request.values.is_web_accessible) {
			const rootApi = api.clone({
				passthrough: {
					req: permissions.root,
				},
			});
			waitPromises.push(
				sbvrUtils
					.getAffectedIds(args)
					.then((deviceIds) =>
						checkDevicesCanHaveDeviceURL(rootApi, deviceIds),
					),
			);
		}

		if (request.values.belongs_to__application != null) {
			waitPromises.push(
				sbvrUtils
					.getAffectedIds(args)
					.then((deviceIds) =>
						checkDevicesCanBeInApplication(
							api,
							request.values.belongs_to__application,
							deviceIds,
						),
					),
			);
		}

		await Promise.all(waitPromises);
	},
	POSTRUN: async (args) => {
		const waitPromises: Array<PromiseLike<any>> = [];
		const affectedIds = args.request.affectedIds!;

		// We only want to set dependent devices offline when the gateway goes
		// offline, when the gateway comes back it's its job to set the dependent
		// device back to online as need be.
		const isOnline = args.request.values.is_online;
		if ([false, 0].includes(isOnline) && affectedIds.length !== 0) {
			waitPromises.push(
				args.api.patch({
					resource: 'device',
					options: {
						$filter: {
							is_managed_by__device: { $in: affectedIds },
							is_online: { $ne: isOnline },
						},
					},
					body: {
						is_online: isOnline,
					},
				}),
			);
		}

		// We need to delete all service_install resources for the current device and
		// create new ones for the new application (if the device is moving application)
		if (args.request.values.belongs_to__application != null) {
			// Also mark all image installs of moved devices as deleted because
			// they're for the previous application.
			const { movedDevices } = args.request.custom;
			if (movedDevices.length > 0) {
				waitPromises.push(
					args.api.patch({
						resource: 'image_install',
						body: {
							status: 'deleted',
						},
						options: {
							$filter: {
								device: { $in: movedDevices },
							},
						},
					}),
				);
			}
		}

		await Promise.all(waitPromises);
	},
});
