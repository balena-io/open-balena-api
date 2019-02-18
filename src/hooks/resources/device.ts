import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as crypto from 'crypto';

import {
	checkDevicesCanHaveDeviceURL,
	checkDevicesCanBeInApplication,
} from '../../lib/application-types';

import * as deviceTypes from '../../lib/device-types';
import * as haikuName from '../../lib/haiku-name';
import { postDevices } from '../../lib/device-proxy';

import {
	sbvrUtils,
	root,
	PinejsClient,
	createActor,
	getCurrentRequestAffectedIds,
	addDeleteHookForDependents,
} from '../../platform';
const { BadRequestError } = sbvrUtils;
import { InaccessibleAppError } from '../../lib/errors';

import { PinejsClientCoreFactory } from 'pinejs-client-core';

const INVALID_NEWLINE_REGEX = /\r|\n/;

export const isDeviceNameValid = (name: string) => {
	return !INVALID_NEWLINE_REGEX.test(name);
};

const createReleaseServiceInstalls = (
	api: PinejsClient,
	deviceId: number,
	releaseFilter: PinejsClientCoreFactory.Filter,
): Promise<void> =>
	api
		.get({
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
				$expand: {
					'service_install/$count': {
						$filter: {
							device: deviceId,
						},
					},
				},
			},
		})
		.map(service => {
			// Filter out any services which do have a service install attached
			if (service.service_install > 0) {
				return;
			}

			// Create a service_install for this pair of service and device
			return api
				.post({
					resource: 'service_install',
					body: {
						device: deviceId,
						installs__service: service.id,
					},
					options: { returnResource: false },
				})
				.return();
		})
		.return();

const createAppServiceInstalls = (
	api: PinejsClient,
	appId: number,
	deviceIds: number[],
): Promise<void> =>
	// Get the current release for this application
	api
		.get({
			resource: 'application',
			id: appId,
			options: { $select: 'commit' },
		})
		.then(({ commit }: AnyObject) => {
			if (commit == null) {
				return;
			}

			return Promise.map(deviceIds, deviceId =>
				createReleaseServiceInstalls(api, deviceId, {
					belongs_to__application: appId,
					status: 'success',
					commit,
				}),
			).return();
		});

sbvrUtils.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: createActor,
});

sbvrUtils.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: args => {
		const { request } = args;
		const waitPromises = [];

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

		// transform to canonical slug in case the UI and API are out of sync
		waitPromises.push(
			deviceTypes
				.normalizeDeviceType(request.values.device_type)
				.then(deviceType => {
					request.values.device_type = deviceType;
					request.values.device_name =
						request.values.device_name || haikuName.generate();
					request.values.uuid =
						request.values.uuid || crypto.pseudoRandomBytes(31).toString('hex');

					if (!/^[a-f0-9]{32}([a-f0-9]{30})?$/.test(request.values.uuid)) {
						throw new BadRequestError(
							'Device UUID must be a 32 or 62 character long lower case hex string.',
						);
					}
				}),
		);
		return Promise.all(waitPromises);
	},
	POSTRUN: ({ request, api, tx, result: deviceId }) => {
		// Don't try to add service installs if the device wasn't created
		if (deviceId == null) {
			return;
		}

		const rootApi = api.clone({ passthrough: { tx, req: root } });

		return createAppServiceInstalls(rootApi, request.custom.appId, [deviceId]);
	},
});

sbvrUtils.addPureHook('PATCH', 'resin', 'device', {
	POSTPARSE: args => {
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
	PRERUN: args => {
		const { api, request } = args;
		const waitPromises: Array<Promise<any>> = [];

		if (
			request.values.is_connected_to_vpn != null ||
			request.values.should_be_running__release !== undefined ||
			_.includes([false, 0], request.values.is_online) ||
			request.values.belongs_to__application != null ||
			request.values.device_name != null
		) {
			// Cache affected ids for later
			waitPromises.push(getCurrentRequestAffectedIds(args));
		}

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
					.then(app => {
						if (app == null) {
							throw new InaccessibleAppError();
						}

						return getCurrentRequestAffectedIds(args)
							.then(deviceIds =>
								// and get the devices being affected and store them for the POSTRUN...
								args.api.get({
									resource: 'device',
									options: {
										$filter: {
											id: {
												$in: deviceIds,
											},
										},
										$expand: {
											belongs_to__application: {
												$select: 'id',
											},
										},
									},
								}),
							)
							.then(devices => {
								request.custom.devices = devices;
							});
					}),
			);
		}

		// check the release is valid for the devices affected...
		if (request.values.should_be_running__release != null) {
			waitPromises.push(
				getCurrentRequestAffectedIds(args).then(deviceIds => {
					if (deviceIds.length === 0) {
						return;
					}
					return args.api
						.get({
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
						})
						.then(release => {
							if (release == null) {
								throw new BadRequestError(
									'Release is not valid for this device',
								);
							}
						});
				}),
			);
		}

		if (request.values.is_web_accessible) {
			const rootApi = api.clone({
				passthrough: {
					req: root,
				},
			});
			waitPromises.push(
				getCurrentRequestAffectedIds(args).then(deviceIds =>
					checkDevicesCanHaveDeviceURL(rootApi, deviceIds),
				),
			);
		}

		if (request.values.belongs_to__application != null) {
			waitPromises.push(
				getCurrentRequestAffectedIds(args).then(deviceIds =>
					checkDevicesCanBeInApplication(
						api,
						request.values.belongs_to__application,
						deviceIds,
					),
				),
			);
		}

		return Promise.all(waitPromises);
	},
	POSTRUN: args => {
		const waitPromises: Array<Promise<any>> = [];
		const affectedIds = args.request.custom.affectedIds as ReturnType<
			typeof getCurrentRequestAffectedIds
		>;

		// Only update devices if they have had their app changed, or the device
		// name has changed - so a user can restart their service and it will
		// pick up the change
		if (
			args.request.values.belongs_to__application != null ||
			args.request.values.device_name != null
		) {
			waitPromises.push(
				affectedIds.then(deviceIds =>
					postDevices({
						url: '/v1/update',
						req: root,
						filter: { id: { $in: deviceIds } },
						// Don't wait for the posts to complete, as they may take a long time
						wait: false,
					}),
				),
			);
		}

		// We only want to set dependent devices offline when the gateway goes
		// offline, when the gateway comes back it's its job to set the dependent
		// device back to online as need be.
		const isOnline = args.request.values.is_online;
		if (_.includes([false, 0], isOnline)) {
			waitPromises.push(
				affectedIds.then(deviceIds => {
					if (deviceIds.length === 0) {
						return;
					}
					return args.api
						.patch({
							resource: 'device',
							options: {
								$filter: {
									is_managed_by__device: { $in: deviceIds },
									is_online: { $ne: isOnline },
								},
							},
							body: {
								is_online: isOnline,
							},
						})
						.return();
				}),
			);
		}

		// We need to delete all service_install resources for the current device and
		// create new ones for the new application (if the device is moving application)
		if (args.request.values.belongs_to__application != null) {
			waitPromises.push(
				affectedIds.tap(deviceIds => {
					if (deviceIds.length === 0) {
						return;
					}
					return args.api
						.delete({
							resource: 'service_install',
							options: {
								$filter: {
									device: { $in: deviceIds },
								},
							},
						})
						.then(() =>
							createAppServiceInstalls(
								args.api,
								args.request.values.belongs_to__application,
								deviceIds,
							),
						);
				}),
			);

			// Also mark all image installs which are part of the current
			// application as deleted.
			waitPromises.push(
				(args.request.custom.devices as Promise<AnyObject[]>).map(device => {
					if (
						device.belongs_to__application[0].id ===
						args.request.values.belongs_to__application
					) {
						return;
					}

					return args.api
						.patch({
							resource: 'image_install',
							body: {
								status: 'deleted',
							},
							options: {
								$filter: {
									device: device.id,
								},
							},
						})
						.return();
				}),
			);
		}

		if (args.request.values.should_be_running__release !== undefined) {
			// If the device has been pinned, we should alert the supervisor
			waitPromises.push(
				affectedIds.then(deviceIds => {
					if (deviceIds.length === 0) {
						return;
					}

					return postDevices({
						url: '/v1/update',
						req: root,
						filter: { id: { $in: deviceIds } },
						// Don't wait for the posts to complete, as they may take a long time
						wait: false,
					});
				}),
			);

			// If the device was preloaded, and then pinned, service_installs do not exist
			// for this device+release combination. We need to create these
			if (args.request.values.should_be_running__release != null) {
				waitPromises.push(
					affectedIds.map(dId =>
						createReleaseServiceInstalls(args.api, dId, {
							id: args.request.values.should_be_running__release,
						}),
					),
				);
			}
		}

		return Promise.all(waitPromises).return();
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
