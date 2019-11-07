import * as _ from 'lodash';
import * as Promise from 'bluebird';

import {
	captureException,
	translateError,
	handleHttpErrors,
} from '../platform/errors';

import { sbvrUtils } from '@resin/pinejs';
import { resinApi, root, PinejsClient } from '../platform';
import { checkInt, isValidInteger, getIP, varListInsert } from '../lib/utils';
import { createDeviceApiKey } from '../lib/api-keys';
import * as randomstring from 'randomstring';
import { RequestHandler } from 'express';
import { PinejsClientCoreFactory } from 'pinejs-client-core';
import {
	setMinPollInterval,
	getReleaseForDevice,
	serviceInstallFromImage,
	formatImageLocation,
	filterDeviceConfig,
} from '../lib/device-state';

export { proxy } from '../lib/device-proxy';

const { BadRequestError, UnauthorizedError } = sbvrUtils;

export const register: RequestHandler = (req, res) =>
	Promise.try(() => {
		const userId = checkInt(req.body.user);
		if (userId === false) {
			throw new BadRequestError('User ID must be a valid integer');
		}

		const applicationId = checkInt(req.body.application);
		if (applicationId === false) {
			throw new BadRequestError('Application ID must be a valid integer');
		}

		const deviceType = req.body.device_type;
		if (deviceType == null) {
			throw new BadRequestError('Device type must be specified');
		}

		const uuid = req.body.uuid;
		if (uuid == null) {
			throw new BadRequestError('UUID must be specified');
		}

		if (req.apiKey == null) {
			throw new BadRequestError('API key must be used for registering');
		}

		const deviceApiKey =
			req.body.api_key != null ? req.body.api_key : randomstring.generate();

		// Temporarily give the ability to fetch the device we create and create an api key for it,
		// but clone to make sure it isn't propagated elsewhere
		req = _.clone(req);
		req.apiKey = _.cloneDeep(req.apiKey);
		if (req.apiKey != null && req.apiKey.permissions != null) {
			req.apiKey.permissions.push('resin.device.get');
			req.apiKey.permissions.push('resin.device.create-device-api-key');
		}

		return sbvrUtils.db.transaction(tx =>
			resinApi
				.post({
					resource: 'device',
					passthrough: { req, tx },
					body: {
						belongs_to__user: userId,
						belongs_to__application: applicationId,
						device_type: deviceType,
						uuid,
					},
				})
				.then((device: AnyObject) => {
					if (device == null) {
						throw new Error('Failed to create device');
					}
					return createDeviceApiKey(req, device.id, {
						apiKey: deviceApiKey,
						tx,
					}).then(apiKey => {
						return {
							id: device.id,
							uuid: device.uuid,
							api_key: apiKey,
						};
					});
				}),
		);
	})
		.then(response => {
			res.status(201).json(response);
		})
		.catch(err => {
			captureException(err, 'Error registering device', { req });
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			res.status(403).send(translateError(err));
		});

// This endpoint takes an array containing the local_id's of all the
// dependent devices discovered by a gateway device and decides what to do for each one.
// The main aim is to ensure that a dependent device can only ever be managed
// by one gateway at any one time.
//
// This endpoint will:
// If the dependent device does not already exist it will be provisioned.
// If an existing managed dependent device is not in the array it will be set as unmanaged.
// If an existing dependent device is in the array and unmanaged it will be managed by this gateway.
// If a dependent device is in the array and is already managed by this gateway the
// is_locked_until__date will be updated.
// If a dependent device is in the array and is already managed by a different gateway
// then nothing is done.
//
// A dependent device is unmanaged if: is_managed_by__device = null OR
// is_locked_until__date = null OR is_locked_until__date = expired
// A dependent device is managed if: is_managed_by__device != null AND
// is_locked_until__date > now
export const receiveOnlineDependentDevices: RequestHandler = (req, res) =>
	Promise.try(() => {
		const {
			user,
			gateway,
			dependent_app,
			dependent_device_type,
			online_dependent_devices,
			expiry_date,
		} = req.body;
		if (!isValidInteger(user)) {
			throw new BadRequestError('user not found or invalid');
		}
		if (!isValidInteger(gateway)) {
			throw new BadRequestError('gateway not found or invalid');
		}
		if (!isValidInteger(dependent_app)) {
			throw new BadRequestError('dependent_app not found or invalid');
		}
		if (
			dependent_device_type == null ||
			_.isEmpty(dependent_device_type) ||
			!_.isString(dependent_device_type)
		) {
			throw new BadRequestError('dependent_device_type not found or invalid');
		}
		if (
			online_dependent_devices == null ||
			!_.isArray(online_dependent_devices)
		) {
			throw new BadRequestError(
				'online_dependent_devices not found or invalid',
			);
		}
		if (!isValidInteger(expiry_date)) {
			throw new BadRequestError('expiry_date not found or invalid');
		}

		const resinApiTx = resinApi.clone({ passthrough: { req } });

		// Get all existing dependent devices, these are used figure out
		// which of the online_dependent_devices needs to be provisioned
		return resinApiTx
			.get({
				resource: 'device',
				options: {
					$select: 'local_id',
					$filter: {
						belongs_to__application: dependent_app,
					},
				},
			})
			.then((devices: AnyObject[]) =>
				// Get the local_id for each dependent device that needs to be provisioned
				_.difference(
					online_dependent_devices,
					devices.map(({ local_id }) => local_id),
				),
			)
			.map(localId =>
				// Provision new dependent devices
				resinApiTx.post({
					resource: 'device',
					body: {
						uuid: randomstring.generate({ length: 62, charset: 'hex' }),
						belongs_to__user: user,
						belongs_to__application: dependent_app,
						device_type: dependent_device_type,
						local_id: localId,
						logs_channel: randomstring.generate({ length: 62, charset: 'hex' }),
					},
					options: { returnResource: false },
				}),
			)
			.then(() =>
				// Set all dependent devices currently being managed by
				// this gateway to unmanaged
				resinApiTx.patch({
					resource: 'device',
					options: {
						$filter: {
							is_managed_by__device: gateway,
							belongs_to__application: dependent_app,
						},
					},
					body: {
						is_managed_by__device: null,
						is_locked_until__date: null,
						is_online: false,
					},
				}),
			)
			.then(() => {
				if (_.isEmpty(online_dependent_devices)) {
					return;
				}

				// Set all dependent devices that are in online_dependent_devices
				// and unmanaged to managed
				return resinApiTx
					.patch({
						resource: 'device',
						options: {
							$filter: {
								local_id: { $in: online_dependent_devices },
								belongs_to__application: dependent_app,
								$or: [
									{
										is_managed_by__device: null,
									},
									{
										is_locked_until__date: null,
									},
									{
										is_locked_until__date: { $le: { $now: {} } },
									},
								],
							},
						},
						body: {
							is_managed_by__device: gateway,
							is_locked_until__date: expiry_date,
							is_online: true,
						},
					})
					.return();
			})
			.then(() => {
				res.sendStatus(200);
			});
	}).catch(err => {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error handling dependent device scan', { req });
		res.status(403).send(translateError(err));
	});

// These 2 config vars below are mapped to labels if missing for backwards-compatibility
// See: https://github.com/resin-io/hq/issues/1340
const ConfigurationVarsToLabels = {
	RESIN_SUPERVISOR_UPDATE_STRATEGY: 'io.resin.update.strategy',
	RESIN_SUPERVISOR_HANDOVER_TIMEOUT: 'io.resin.update.handover-timeout',
};

const releaseExpand = {
	$select: ['id', 'commit', 'composition'],
	$expand: {
		contains__image: {
			$select: 'id',
			$expand: {
				image: {
					$select: [
						'id',
						'is_stored_at__image_location',
						'content_hash',
						'is_a_build_of__service',
						'contract',
					],
				},
				image_label: {
					$select: ['label_name', 'value'],
				},
				image_environment_variable: {
					$select: ['name', 'value'],
				},
			},
		},
	},
};
const stateQuery = resinApi.prepare<{ uuid: string }>({
	resource: 'device',
	options: {
		$select: ['device_name', 'os_version'],
		$filter: { uuid: { '@': 'uuid' } },
		$expand: {
			device_config_variable: {
				$select: ['name', 'value'],
				$orderby: {
					name: 'asc',
				},
			},
			device_environment_variable: {
				$select: ['name', 'value'],
			},
			should_be_running__release: releaseExpand,
			service_install: {
				$select: ['id'],
				$expand: {
					service: {
						$select: ['id', 'service_name'],
						$expand: {
							service_environment_variable: {
								$select: ['name', 'value'],
							},
							service_label: {
								$select: ['label_name', 'value'],
							},
						},
					},
					device_service_environment_variable: {
						$select: ['name', 'value'],
					},
				},
			},
			belongs_to__application: {
				$select: ['id', 'app_name'],
				$expand: {
					application_config_variable: {
						$select: ['name', 'value'],
						$orderby: {
							name: 'asc',
						},
					},
					application_environment_variable: {
						$select: ['name', 'value'],
					},
					is_depended_on_by__application: {
						$select: ['id', 'app_name'],
						$expand: {
							application_config_variable: {
								$select: ['name', 'value'],
								$orderby: {
									name: 'asc',
								},
							},
							application_environment_variable: {
								$select: ['name', 'value'],
							},
							should_be_running__release: releaseExpand,
						},
					},
					should_be_running__release: releaseExpand,
				},
			},
			manages__device: {
				$select: ['uuid', 'device_name', 'belongs_to__application'],
				$expand: {
					service_install: {
						$select: ['id'],
						$top: 1,
						$expand: {
							device_service_environment_variable: {
								$select: ['name', 'value'],
							},
							service: {
								$select: ['id'],
								$expand: {
									service_environment_variable: {
										$select: ['name', 'value'],
									},
								},
							},
						},
					},
					device_config_variable: {
						$select: ['name', 'value'],
					},
					device_environment_variable: {
						$select: ['name', 'value'],
					},
				},
			},
		},
	},
});

export const state: RequestHandler = (req, res) => {
	const uuid = req.param('uuid');
	if (!uuid) {
		return res.send(400);
	}

	sbvrUtils.db.readTransaction!(tx =>
		stateQuery({ uuid }, undefined, { req, tx }),
	)
		.then(([device]: AnyObject[]) => {
			if (!device) {
				throw new UnauthorizedError();
			}

			const parentApp: AnyObject = device.belongs_to__application[0];

			const release = getReleaseForDevice(device);
			const config: Dictionary<string> = {};
			varListInsert(parentApp.application_config_variable, config);
			varListInsert(device.device_config_variable, config);
			filterDeviceConfig(config, device.os_version);
			setMinPollInterval(config);

			const services: AnyObject = {};

			let composition: AnyObject | undefined;
			if (release != null) {
				// Parse the composition to forward values to the device
				if (_.isObject(release.composition)) {
					composition = release.composition;
				} else {
					try {
						composition = JSON.parse(release.composition);
					} catch (e) {
						composition = {};
					}
				}

				(release.contains__image as AnyObject[]).forEach(ipr => {
					// extract the per-image information
					const image = ipr.image[0];

					const si = serviceInstallFromImage(device, image);
					if (si == null) {
						throw new Error('Could not find service install');
					}
					const svc = si.service[0];

					const environment: Dictionary<string> = {};
					varListInsert(ipr.image_environment_variable, environment);
					varListInsert(
						parentApp.application_environment_variable,
						environment,
					);
					varListInsert(svc.service_environment_variable, environment);
					varListInsert(device.device_environment_variable, environment);
					varListInsert(si.device_service_environment_variable, environment);

					const labels: Dictionary<string> = {};
					[...ipr.image_label, ...svc.service_label].forEach(
						({ label_name, value }: { label_name: string; value: string }) => {
							labels[label_name] = value;
						},
					);

					_.each(ConfigurationVarsToLabels, (labelName, confName) => {
						if (confName in config && !(labelName in labels)) {
							labels[labelName] = config[confName];
						}
					});

					const imgRegistry =
						image.is_stored_at__image_location +
						(image.content_hash != null ? `@${image.content_hash}` : '');

					services[svc.id] = {
						imageId: image.id,
						serviceName: svc.service_name,
						image: formatImageLocation(imgRegistry),
						// This needs spoken about...
						running: true,
						environment,
						labels,
					};
					// Don't send a null contract as this is a waste
					// of bandwidth (a null contract is the same as
					// the lack of a contract field)
					if (image.contract != null) {
						services[svc.id].contract = image.contract;
					}

					if (
						composition != null &&
						composition.services != null &&
						composition.services[svc.service_name] != null
					) {
						const compositionService = composition.services[svc.service_name];
						// We remove the `build` properly explicitly as it's expected to be present
						// for the builder, but makes no sense for the supervisor to support
						delete compositionService.build;
						services[svc.id] = {
							...compositionService,
							...services[svc.id],
						};
					}
				});
			}

			const volumes = composition != null ? composition.volumes || {} : {};
			const networks = composition != null ? composition.networks || {} : {};

			const local = {
				name: device.device_name,
				config,
				apps: {
					[parentApp.id]: {
						name: parentApp.app_name,
						commit: release == null ? undefined : release.commit,
						releaseId: release == null ? undefined : release.id,
						services,
						volumes,
						networks,
					},
				},
			};

			const dependent = {
				apps: {} as AnyObject,
				devices: {} as AnyObject,
			};

			const depAppCache: Dictionary<{
				release?: AnyObject;
				application_environment_variable: Array<{
					name: string;
					value: string;
				}>;
			}> = {};

			(parentApp.is_depended_on_by__application as AnyObject[]).forEach(
				depApp => {
					const release = _.get(depApp, 'should_be_running__release[0]');
					depAppCache[depApp.id] = {
						release,
						application_environment_variable:
							depApp.application_environment_variable,
					};

					const config: Dictionary<string> = {};
					varListInsert(depApp.application_config_variable, config);

					dependent.apps[depApp.id] = {
						name: depApp.app_name,
						parentApp: parentApp.id,
						config,
					};

					const image = _.get(release, 'contains__image[0].image[0]');
					if (release != null && image != null) {
						const depAppState = dependent.apps[depApp.id];
						depAppState.releaseId = release.id;
						depAppState.imageId = image.id;
						depAppState.commit = release.commit;
						depAppState.image = formatImageLocation(
							image.is_stored_at__image_location,
						);
					}
				},
			);

			(device.manages__device as AnyObject[]).forEach(depDev => {
				const depAppId: number = depDev.belongs_to__application.__id;
				const { release, application_environment_variable } = depAppCache[
					depAppId
				];

				const config: Dictionary<string> = {};
				varListInsert(depDev.device_config_variable, config);

				const ipr = _.get(release, 'contains__image[0]');
				const image = _.get(ipr, 'image[0]');
				const svcInstall = serviceInstallFromImage(depDev, image);

				const environment: Dictionary<string> = {};
				if (ipr != null) {
					varListInsert(ipr.image_environment_variable, environment);
				}

				varListInsert(application_environment_variable, environment);
				if (
					svcInstall != null &&
					svcInstall.service != null &&
					svcInstall.service[0] != null
				) {
					varListInsert(
						svcInstall.service[0].service_environment_variable,
						environment,
					);
				}

				varListInsert(depDev.device_environment_variable, environment);
				if (svcInstall != null) {
					varListInsert(
						svcInstall.device_service_environment_variable,
						environment,
					);
				}

				dependent.devices[depDev.uuid] = {
					name: depDev.device_name,
					apps: {
						[depAppId]: {
							config,
							environment,
						},
					},
				};
			});

			res.json({
				local,
				dependent,
			});
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error getting device state', { req });
			res.sendStatus(500);
		});
};

const upsertImageInstall = (
	api: PinejsClient,
	imageId: number,
	deviceId: number,
	status: string,
	releaseId: number,
	dlProg?: number,
): Promise<void> =>
	api
		.get({
			resource: 'image_install',
			options: {
				$select: 'id',
				$filter: {
					installs__image: imageId,
					device: deviceId,
				},
			},
		})
		.then(([imgInstall]: AnyObject[]) => {
			if (imgInstall == null) {
				// we need to create it with a POST
				return api.post({
					resource: 'image_install',
					body: {
						device: deviceId,
						installs__image: imageId,
						install_date: new Date(),
						status,
						download_progress: dlProg,
						is_provided_by__release: releaseId,
					},
					options: { returnResource: false },
				});
			} else {
				// we need to update the current image install
				const body: AnyObject = {
					status,
					is_provided_by__release: releaseId,
				};
				if (dlProg !== undefined) {
					body.download_progress = dlProg;
				}
				return api.patch({
					resource: 'image_install',
					body,
					options: {
						$filter: {
							installs__image: imageId,
							device: deviceId,
							$not: body,
						},
					},
				});
			}
		})
		.return();

const upsertGatewayDownload = (
	api: PinejsClient,
	deviceId: number,
	imageId: number,
	status: string,
	downloadProgress: number,
): Promise<void> =>
	api
		.get({
			resource: 'gateway_download',
			options: {
				$select: 'id',
				$filter: {
					image: imageId,
					is_downloaded_by__device: deviceId,
				},
			},
		})
		.then(([gatewayDownload]: AnyObject[]) => {
			if (gatewayDownload == null) {
				return api.post({
					resource: 'gateway_download',
					body: {
						image: imageId,
						is_downloaded_by__device: deviceId,
						status,
						download_progress: downloadProgress,
					},
					options: { returnResource: false },
				});
			} else {
				return api.patch({
					resource: 'gateway_download',
					body: {
						status,
						download_progress: downloadProgress,
					},
					options: {
						$filter: {
							is_downloaded_by__device: deviceId,
							image: imageId,
						},
					},
				});
			}
		})
		.return();

const deleteOldGatewayDownloads = (
	api: PinejsClient,
	deviceId: number,
	imageIds: number[],
): Promise<void> => {
	const filter: PinejsClientCoreFactory.Filter = {
		is_downloaded_by__device: deviceId,
	};

	if (imageIds.length !== 0) {
		filter.$not = { image: { $in: imageIds } };
	}

	return api
		.patch({
			resource: 'gateway_download',
			options: {
				$filter: filter,
			},
			body: { status: 'deleted' },
		})
		.return();
};

const validPatchFields = [
	'is_managed_by__device',
	'should_be_running__release',
	'device_name',
	'status',
	'is_online',
	'note',
	'os_version',
	'os_variant',
	'supervisor_version',
	'provisioning_progress',
	'provisioning_state',
	'ip_address',
	'download_progress',
	'api_port',
	'api_secret',
	'logs_channel',
];

export const statePatch: RequestHandler = (req, res) => {
	const uuid = req.param('uuid');
	if (!uuid) {
		return res.send(400);
	}

	const custom: AnyObject = {}; // shove custom values here to make them available to the hooks

	const values = req.body;
	// firstly we need to extract all fields which should be sent to the device
	// resource which is everything but the service entries

	// Every field that is passed to the endpoint is the same, except
	// device name
	const { local, dependent } = values;

	let apps: undefined | AnyObject[];
	let deviceBody: undefined | AnyObject;
	if (local != null) {
		apps = local.apps;

		deviceBody = _.pick(local, validPatchFields);

		if (local.name != null) {
			deviceBody.device_name = local.name;
		}
	}

	// forward the public ip address if the request is from the supervisor.
	if (req.apiKey != null) {
		custom.ipAddress = getIP(req);
	}

	return sbvrUtils.db
		.transaction(tx => {
			const resinApiTx = resinApi.clone({ passthrough: { req, custom, tx } });

			return resinApiTx
				.get({
					resource: 'device',
					options: {
						$select: 'id',
						$filter: { uuid },
					},
				})
				.tap(([device]: AnyObject[]) => {
					if (device == null) {
						throw new UnauthorizedError();
					}

					if (local.is_on__commit === null) {
						deviceBody!.is_running__release = null;
					} else if (local.is_on__commit !== undefined) {
						return resinApiTx
							.get({
								resource: 'release',
								options: {
									$select: 'id',
									$filter: {
										commit: local.is_on__commit,
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
																	d: { uuid },
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
							.then(([release]: AnyObject[]) => {
								deviceBody!.is_running__release = release.id;
							});
					}
				})
				.then(([device]: AnyObject[]) => {
					const waitPromises: Array<PromiseLike<any>> = [];

					if (!_.isEmpty(deviceBody)) {
						waitPromises.push(
							resinApiTx.patch({
								resource: 'device',
								id: device.id,
								options: {
									$filter: { $not: deviceBody },
								},
								body: deviceBody,
							}),
						);
					}

					if (apps != null) {
						const imageIds: number[] = [];

						_.each(apps, app => {
							_.each(app.services, (svc, imageIdStr) => {
								const imageId = _.parseInt(imageIdStr, 10);
								imageIds.push(imageId);
								const { status, download_progress } = svc;
								const releaseId = _.parseInt(svc.releaseId, 10);

								if (!_.isFinite(imageId)) {
									throw new BadRequestError(
										'Invalid image ID value in request',
									);
								}
								if (!_.isFinite(releaseId)) {
									throw new BadRequestError(
										'Invalid release ID value in request',
									);
								}

								waitPromises.push(
									upsertImageInstall(
										resinApiTx,
										imageId,
										device.id,
										status,
										releaseId,
										download_progress,
									),
								);
							});
						});

						// Get access to a root api, as images shouldn't be allowed to change
						// the service_install values
						const rootApi = resinApiTx.clone({ passthrough: { req: root } });

						const body = { status: 'deleted' };
						const filter: PinejsClientCoreFactory.Filter = {
							device: device.id,
						};
						if (imageIds.length !== 0) {
							filter.$not = [body, { image: { $in: imageIds } }];
						} else {
							filter.$not = body;
						}

						waitPromises.push(
							rootApi.patch({
								resource: 'image_install',
								body,
								options: {
									$filter: filter,
								},
							}),
						);
					}

					if (dependent != null && dependent.apps != null) {
						// Handle dependent devices if necessary
						const imageIds: number[] = [];
						_.each(dependent.apps, ({ images }) => {
							_.each(images, ({ status, download_progress }, imageIdStr) => {
								const imageId = parseInt(imageIdStr, 10);
								imageIds.push(imageId);
								waitPromises.push(
									upsertGatewayDownload(
										resinApiTx,
										device.id,
										imageId,
										status,
										download_progress,
									),
								);
							});
						});

						waitPromises.push(
							deleteOldGatewayDownloads(resinApiTx, device.id, imageIds),
						);
					}

					return Promise.all(waitPromises);
				});
		})
		.then(() => {
			res.sendStatus(200);
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error setting device state', { req });
			res.sendStatus(500);
		});
};
