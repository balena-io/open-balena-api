import type { RequestHandler } from 'express';

import * as _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import {
	filterDeviceConfig,
	formatImageLocation,
	getReleaseForDevice,
	serviceInstallFromImage,
	setMinPollInterval,
} from '../utils';
import { sbvrUtils, errors } from '@balena/pinejs';
import { events } from '..';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (varList: EnvVarList, obj: Dictionary<string>) => {
	varList.forEach((evar) => {
		obj[evar.name] = evar.value;
	});
};

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

const stateQuery = _.once(() =>
	api.resin.prepare<{ uuid: string }>({
		resource: 'device',
		id: { uuid: { '@': 'uuid' } },
		options: {
			$select: ['device_name', 'os_version'],
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
	}),
);

export const state: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}
	const { apiKey } = req;
	events.emit('get-state', uuid, { apiKey });

	try {
		const device = await sbvrUtils.db.readTransaction!((tx) =>
			stateQuery()({ uuid }, undefined, { req, tx }),
		);

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

			(release.contains__image as AnyObject[]).forEach((ipr) => {
				// extract the per-image information
				const image = ipr.image[0];

				const si = serviceInstallFromImage(device, image);
				if (si == null) {
					throw new Error(
						`Could not find service install for device: '${uuid}', image: '${
							image?.id
						}', service: '${JSON.stringify(
							image?.is_a_build_of__service,
						)}', service installs: '${JSON.stringify(device.service_install)}'`,
					);
				}
				const svc = si.service[0];

				const environment: Dictionary<string> = {};
				varListInsert(ipr.image_environment_variable, environment);
				varListInsert(parentApp.application_environment_variable, environment);
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

		const volumes = composition?.volumes || {};
		const networks = composition?.networks || {};

		const local = {
			name: device.device_name,
			config,
			apps: {
				[parentApp.id]: {
					name: parentApp.app_name,
					commit: release?.commit,
					releaseId: release?.id,
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
			(depApp) => {
				const depRelease = depApp?.should_be_running__release?.[0];
				depAppCache[depApp.id] = {
					release: depRelease,
					application_environment_variable:
						depApp.application_environment_variable,
				};

				const depConfig: Dictionary<string> = {};
				varListInsert(depApp.application_config_variable, depConfig);

				dependent.apps[depApp.id] = {
					name: depApp.app_name,
					parentApp: parentApp.id,
					config: depConfig,
				};

				const image = depRelease?.contains__image?.[0]?.image?.[0];
				if (depRelease != null && image != null) {
					const depAppState = dependent.apps[depApp.id];
					depAppState.releaseId = depRelease.id;
					depAppState.imageId = image.id;
					depAppState.commit = depRelease.commit;
					depAppState.image = formatImageLocation(
						image.is_stored_at__image_location,
					);
				}
			},
		);

		(device.manages__device as AnyObject[]).forEach((depDev) => {
			const depAppId: number = depDev.belongs_to__application.__id;
			const {
				release: depRelease,
				application_environment_variable,
			} = depAppCache[depAppId];

			const depConfig: Dictionary<string> = {};
			varListInsert(depDev.device_config_variable, depConfig);

			const ipr = depRelease?.contains__image?.[0];
			const image = ipr?.image?.[0];
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
						config: depConfig,
						environment,
					},
				},
			};
		});

		res.json({
			local,
			dependent,
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting device state', { req });
		res.sendStatus(500);
	}
};
