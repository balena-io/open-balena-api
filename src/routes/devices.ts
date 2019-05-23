import * as _ from 'lodash';
import * as Promise from 'bluebird';

import {
	captureException,
	translateError,
	handleHttpErrors,
} from '../platform/errors';

import { resinApi, root, sbvrUtils, PinejsClient, db } from '../platform';
import { checkInt, isValidInteger, getIP, varListInsert } from '../lib/utils';
import { createDeviceApiKey } from '../lib/api-keys';
import * as randomstring from 'randomstring';
import { RequestHandler } from 'express';
import { PinejsClientCoreFactory } from 'pinejs-client-core';
import {
	setMinPollInterval,
	getReleaseForDevice,
	releaseFromApp,
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

		return db.transaction(tx =>
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
// If an existing dependent device is in the array and umanaged it will be managed by this gateway.
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

const stateQuery = resinApi.prepare<{ uuid: string }>({
	resource: 'device',
	options: {
		$select: ['device_name', 'os_version'],
		$filter: { uuid: { '@': 'uuid' } },
		$expand: {
			device_config_variable: {
				$select: ['name', 'value'],
			},
			device_environment_variable: {
				$select: ['name', 'value'],
			},
			should_be_running__release: {
				$select: ['id', 'commit', 'composition'],
				$expand: {
					contains__image: {
						$select: ['id'],
						$expand: {
							image: {
								$select: [
									'id',
									'is_stored_at__image_location',
									'content_hash',
									'is_a_build_of__service',
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
			},
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
				$select: ['id', 'app_name', 'commit'],
				$expand: {
					application_config_variable: {
						$select: ['name', 'value'],
					},
					application_environment_variable: {
						$select: ['name', 'value'],
					},
					is_depended_on_by__application: {
						$select: ['id', 'app_name', 'commit'],
						$expand: {
							application_config_variable: {
								$select: ['name', 'value'],
							},
							application_environment_variable: {
								$select: ['name', 'value'],
							},
						},
					},
				},
			},
			manages__device: {
				$select: ['id', 'uuid', 'device_name'],
				$expand: {
					belongs_to__application: {
						$select: ['id', 'depends_on__application', 'commit'],
						$expand: {
							service: {
								$select: ['id'],
								$top: 1,
								$expand: {
									service_environment_variable: {
										$select: ['name', 'value'],
									},
								},
							},
						},
					},
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

	db.readTransaction(tx =>
		stateQuery({ uuid }, undefined, { req, tx }).then(
			([device]: AnyObject[]) => {
				const resinApiTx = resinApi.clone({ passthrough: { req, tx } });
				if (!device) {
					throw new UnauthorizedError();
				}

				return getReleaseForDevice(resinApiTx, device).then(release => {
					const services: AnyObject = {};

					const local = {
						name: device.device_name,
						config: {} as AnyObject,
						apps: {} as AnyObject[],
					};

					// Device and application config variables
					varListInsert(
						device.belongs_to__application[0].application_config_variable,
						local.config,
					);
					varListInsert(device.device_config_variable, local.config);
					local.config = filterDeviceConfig(local.config, device.os_version);

					setMinPollInterval(local.config);

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

						_.each(release.contains__image, ipr => {
							// extract the per-image information
							const image = ipr.image[0];
							let labelList: Array<{ label_name: string; value: string }> =
								ipr.image_label || [];
							let envVars = ipr.image_environment_variable;

							const si = serviceInstallFromImage(device, image);
							if (si == null) {
								throw new Error('Could not find service install');
							}
							const svc = si.service[0];

							// generate the environment and labels objects
							labelList = labelList.concat(svc.service_label);
							envVars = envVars
								.concat(
									device.belongs_to__application[0]
										.application_environment_variable,
								)
								.concat(svc.service_environment_variable)
								.concat(device.device_environment_variable)
								.concat(si.device_service_environment_variable);

							const labels: AnyObject = {};
							labelList.forEach(({ label_name, value }) => {
								labels[label_name] = value;
							});

							_.each(ConfigurationVarsToLabels, (labelName, confName) => {
								if (confName in local.config && !(labelName in labels)) {
									labels[labelName] = local.config[confName];
								}
							});

							const environment = {};
							varListInsert(envVars, environment);

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

							if (
								composition != null &&
								composition.services != null &&
								composition.services[svc.service_name] != null
							) {
								_.each(composition.services[svc.service_name], (v, k) => {
									if (
										![
											'build',
											'image',
											'imageId',
											'serviceName',
											'labels',
											'environment',
										].includes(k)
									) {
										services[svc.id][k] = v;
									}
									return true;
								});
							}
						});
					}

					const volumes = composition != null ? composition.volumes || {} : {};
					const networks =
						composition != null ? composition.networks || {} : {};

					const parentApp = device.belongs_to__application[0];
					local.apps[parentApp.id] = {
						name: parentApp.app_name,
						commit: release == null ? undefined : release.commit,
						releaseId: release == null ? undefined : release.id,
						services,
						volumes,
						networks,
					};

					const dependent = {
						apps: {} as AnyObject,
						devices: {} as AnyObject,
					};

					const depReleases: AnyObject = {};

					return Promise.map(
						(parentApp.is_depended_on_by__application || []) as AnyObject[],
						depApp =>
							// get the release for this application
							releaseFromApp(resinApiTx, depApp, true)
								.then(release => {
									dependent.apps[depApp.id] = {
										name: depApp.app_name,
										parentApp: parentApp.id,
										config: {},
									};

									depReleases[depApp.id] = release;

									const image = _.get(release, 'contains__image[0].image[0]');
									if (release != null && image != null) {
										Object.assign(dependent.apps[depApp.id], {
											releaseId: release.id,
											imageId: image.id,
											commit: depApp.commit,
											image: formatImageLocation(
												image.is_stored_at__image_location,
											),
										});
									}
									if (depApp.application_config_variable != null) {
										varListInsert(
											depApp.application_config_variable,
											dependent.apps[depApp.id].config,
										);
									}
								})
								.then(() => {
									_.each(device.manages__device, depDev => {
										dependent.devices[depDev.uuid] = {
											name: depDev.device_name,
											apps: {
												[depDev.belongs_to__application[0].id]: {
													config: {},
													environment: {},
												},
											},
										};
										const app: AnyObject =
											dependent.devices[depDev.uuid].apps[
												depDev.belongs_to__application[0].id
											];
										varListInsert(depDev.device_config_variable, app.config);

										release = depReleases[depDev.belongs_to__application[0].id];

										const image = _.get(release, 'contains__image[0].image[0]');
										const svcInstall =
											image == null
												? null
												: serviceInstallFromImage(depDev, image);

										if (image != null) {
											varListInsert(
												image.image_environment_variable,
												app.environment,
											);
										}
										varListInsert(
											depApp.application_environment_variable,
											app.environment,
										);
										if (
											svcInstall != null &&
											svcInstall.service != null &&
											svcInstall.service[0] != null
										) {
											varListInsert(
												svcInstall.service[0].service_environment_variable,
												app.environment,
											);
										}
										varListInsert(
											depDev.device_environment_variable,
											app.environment,
										);
										if (svcInstall != null) {
											varListInsert(
												svcInstall.device_service_environment_variable,
												app.environment,
											);
										}
									});
								}),
					).then(() => {
						res.json({
							local,
							dependent,
						});
					});
				});
			},
		),
	).catch(err => {
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
	dlProg: number,
	releaseId: number,
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
				return api.patch({
					resource: 'image_install',
					body: {
						status,
						download_progress: dlProg,
						is_provided_by__release: releaseId,
					},
					options: {
						$filter: {
							installs__image: imageId,
							device: deviceId,
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
	'is_on__commit',
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

	const resinApiTx = resinApi.clone({ passthrough: { req, custom } });
	const imageIds: number[] = [];

	return resinApiTx
		.get({
			resource: 'device',
			options: {
				$select: 'id',
				$filter: { uuid },
			},
		})
		.then(([device]: AnyObject[]) => {
			if (device == null) {
				throw new UnauthorizedError();
			}

			return Promise.try(() => {
				if (!_.isEmpty(deviceBody)) {
					resinApiTx.patch({
						resource: 'device',
						id: device.id,
						body: deviceBody,
					});
				}
			})
				.then(() => {
					if (apps == null) {
						return;
					}

					return Promise.map(_.toPairs(apps), ([, app]) => {
						if (app.services == null) {
							return;
						}
						return Promise.map(
							_.toPairs(app.services as AnyObject[]),
							([imageIdStr, svc]) => {
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

								return upsertImageInstall(
									resinApiTx,
									imageId,
									device.id,
									status,
									download_progress,
									releaseId,
								);
							},
						).return();
					}).return();
				})
				.then(() => {
					if (apps == null) {
						return;
					}

					// Get access to a root api, as images shouldn't be allowed to change
					// the service_install values
					const rootApi = resinApiTx.clone({ passthrough: { req: root } });

					const filter: PinejsClientCoreFactory.Filter = { device: device.id };

					if (imageIds.length !== 0) {
						filter.$not = { image: { $in: imageIds } };
					}

					return rootApi
						.patch({
							resource: 'image_install',
							body: { status: 'deleted' },
							options: { $filter: filter },
						})
						.return();
				})
				.then(() => {
					// Handle dependent devices if necessary
					const depApps: undefined | AnyObject[] =
						dependent == null ? undefined : dependent.apps;
					if (depApps == null) {
						return;
					}

					const imageIds: number[] = [];
					return Promise.map(_.values(depApps), ({ images }) =>
						Promise.map(
							_.toPairs(images as AnyObject),
							([imageIdStr, { status, download_progress }]) => {
								const imageId = parseInt(imageIdStr, 10);
								imageIds.push(imageId);
								return upsertGatewayDownload(
									resinApiTx,
									device.id,
									imageId,
									status,
									download_progress,
								);
							},
						),
					).then(() =>
						deleteOldGatewayDownloads(resinApiTx, device.id, imageIds),
					);
				})
				.then(() => {
					res.sendStatus(200);
				});
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error setting device state', { req });
			res.sendStatus(500);
		});
};
