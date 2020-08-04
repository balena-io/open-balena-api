import * as _ from 'lodash';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';

import { addDeleteHookForDependents, createActor } from '../../platform';

import {
	checkDevicesCanBeInApplication,
	checkDevicesCanHaveDeviceURL,
} from '../../lib/application-types';
import { postDevices } from '../../lib/device-proxy';
import { InaccessibleAppError } from '../../lib/errors';
import * as haikuName from '../../lib/haiku-name';
import { pseudoRandomBytesAsync } from '../../lib/utils';
import { resolveDeviceType } from '../common';

const { BadRequestError } = errors;

const INVALID_NEWLINE_REGEX = /\r|\n/;

export const isDeviceNameValid = (name: string) => {
	return !INVALID_NEWLINE_REGEX.test(name);
};

const createReleaseServiceInstalls = async (
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	releaseFilter: Filter,
): Promise<void> => {
	await Promise.all(
		deviceIds.map(async (deviceId) => {
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
			})) as AnyObject[];
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

sbvrUtils.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: createActor,
});

sbvrUtils.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: ({ api, request }) =>
		resolveDeviceType(api, request, 'is_of__device_type'),
});

sbvrUtils.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: async ({ request }) => {
		// Check for extra whitespace characters
		if (
			request.values.device_name != null &&
			!isDeviceNameValid(request.values.device_name)
		) {
			throw new BadRequestError(
				'Device name cannot contain any newline characters.',
			);
		}
		// Keep the app ID for later -- we'll need it in the POSTRUN hook
		request.custom.appId = request.values.belongs_to__application;

		request.values.device_name =
			request.values.device_name || haikuName.generate();
		request.values.uuid =
			request.values.uuid || (await pseudoRandomBytesAsync(31)).toString('hex');

		if (!/^[a-f0-9]{32}([a-f0-9]{30})?$/.test(request.values.uuid)) {
			throw new BadRequestError(
				'Device UUID must be a 32 or 62 character long lower case hex string.',
			);
		}
	},
	POSTRUN: async ({ request, api, tx, result: deviceId }) => {
		// Don't try to add service installs if the device wasn't created
		if (deviceId == null) {
			return;
		}

		const rootApi = api.clone({ passthrough: { tx, req: permissions.root } });

		await createAppServiceInstalls(rootApi, request.custom.appId, [deviceId]);
	},
});

sbvrUtils.addPureHook('PATCH', 'resin', 'device', {
	POSTPARSE: (args) => {
		const { request } = args;

		// Check for extra whitespace characters
		if (
			request.values.device_name != null &&
			!isDeviceNameValid(request.values.device_name)
		) {
			throw new BadRequestError(
				'Device name cannot contain any newline characters.',
			);
		}
		// Parse and set `os_variant` from `os_version` if not explicitly given
		if (
			request.values.os_version != null &&
			request.values.os_variant == null
		) {
			const match = /^.*\((.+)\)$/.exec(request.values.os_version);
			if (match != null) {
				request.values.os_variant = match[1];
			} else {
				request.values.os_variant = null;
			}
		}

		// When moving application make sure to set the build to null, unless a specific new
		// build has been targeted, instead of pointing to a build of the wrong application
		if (
			request.values.belongs_to__application != null &&
			request.values.should_be_running__release === undefined
		) {
			request.values.should_be_running__release = null;
		}

		if (request.values.is_connected_to_vpn != null) {
			request.values.is_online = request.values.is_connected_to_vpn;
			request.values.last_vpn_event = new Date();
		}

		if (request.values.is_online != null) {
			request.values.last_connectivity_event = new Date();
		}
	},
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

		// Only update devices if they have had their app changed, or the device
		// name has changed - so a user can restart their service and it will
		// pick up the change
		if (
			(args.request.values.belongs_to__application != null ||
				args.request.values.device_name != null) &&
			affectedIds.length !== 0
		) {
			waitPromises.push(
				postDevices({
					url: '/v1/update',
					req: permissions.root,
					filter: { id: { $in: affectedIds } },
					// Don't wait for the posts to complete, as they may take a long time
					wait: false,
				}),
			);
		}

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
			if (affectedIds.length !== 0) {
				waitPromises.push(
					args.api
						.delete({
							resource: 'service_install',
							options: {
								$filter: {
									device: { $in: affectedIds },
								},
							},
						})
						.then(() =>
							createAppServiceInstalls(
								args.api,
								args.request.values.belongs_to__application,
								affectedIds,
							),
						),
				);
			}

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

		if (
			args.request.values.should_be_running__release !== undefined &&
			affectedIds.length !== 0
		) {
			// If the device was preloaded, and then pinned, service_installs do not exist
			// for this device+release combination. We need to create these
			if (args.request.values.should_be_running__release != null) {
				waitPromises.push(
					createReleaseServiceInstalls(args.api, affectedIds, {
						id: args.request.values.should_be_running__release,
					}),
				);
			} else {
				waitPromises.push(
					(async () => {
						const devices = (await args.api.get({
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
									args.api,
									devicesByApp[appId][0].belongs_to__application.__id,
									devicesByApp[appId].map((d) => d.id),
								),
							),
						);
					})(),
				);
			}

			// If the device has been pinned/un-pinned then we should alert the supervisor
			if (affectedIds.length !== 0) {
				waitPromises.push(
					postDevices({
						url: '/v1/update',
						req: permissions.root,
						filter: { id: { $in: affectedIds } },
						// Don't wait for the posts to complete, as they may take a long time
						wait: false,
					}),
				);
			}
		}

		await Promise.all(waitPromises);
	},
});

addDeleteHookForDependents('device', [
	['device_config_variable', 'device'],
	['device_environment_variable', 'device'],
	['device_tag', 'device'],
	['image_install', 'device'],
	['service_install', 'device'],
	['gateway_download', 'is_downloaded_by__device'],
]);
