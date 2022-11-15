import type { RequestHandler } from 'express';
import type { Request } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import {
	filterDeviceConfig,
	formatImageLocation,
	readTransaction,
	getReleaseForDevice,
	serviceInstallFromImage,
	setDefaultConfigVariables,
	rejectUiConfig,
	varListInsert,
	ConfigurationVarsToLabels,
} from '../state-get-utils';
import { sbvrUtils, errors } from '@balena/pinejs';
import { events } from '..';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

type CompositionService = AnyObject;
type LocalStateApp = StateV2['local']['apps'][string];
export type StateV2 = {
	local: {
		name: string;
		config: {
			[varName: string]: string;
		};
		apps: {
			[id: string]: {
				name: string;
				commit?: string;
				releaseId?: number;
				services: {
					[id: string]: CompositionService & {
						imageId: number;
						serviceName: string;
						image: string;
						running: boolean;
						environment: {
							[varName: string]: string;
						};
						labels: {
							[labelName: string]: string;
						};
						contract?: AnyObject;
					};
				};
				volumes: AnyObject;
				networks: AnyObject;
			};
		};
	};
	dependent: {
		apps: {
			[id: string]: {
				name: string;
				parentApp: number;
				config: {
					[varName: string]: string;
				};
				releaseId?: number;
				imageId?: number;
				commit?: string;
				image?: string;
			};
		};
		devices: {
			[uuid: string]: {
				name: string;
				apps: {
					[id: string]: {
						config: {
							[varName: string]: string;
						};
						environment: {
							[varName: string]: string;
						};
					};
				};
			};
		};
	};
};

function buildAppFromRelease(
	device: AnyObject,
	application: AnyObject,
	release: AnyObject,
	config: Dictionary<string>,
): LocalStateApp {
	let composition: AnyObject = {};
	const services: LocalStateApp['services'] = {};

	// Parse the composition to forward values to the device
	if (_.isObject(release.composition)) {
		composition = release.composition;
	} else {
		try {
			composition = JSON.parse(release.composition);
		} catch {
			composition = {};
		}
	}

	for (const ipr of release.contains__image as AnyObject[]) {
		// extract the per-image information
		const image = ipr.image[0];

		const si = serviceInstallFromImage(device, image);
		if (si == null) {
			throw new Error(
				`Could not find service install for device: '${
					application.uuid
				}', image: '${image?.id}', service: '${JSON.stringify(
					image?.is_a_build_of__service,
				)}', service installs: '${JSON.stringify(device.service_install)}'`,
			);
		}
		const svc = si.service[0];

		const environment: Dictionary<string> = {};
		varListInsert(ipr.image_environment_variable, environment);
		varListInsert(application.application_environment_variable, environment);
		varListInsert(svc.service_environment_variable, environment);
		varListInsert(device.device_environment_variable, environment);
		varListInsert(si.device_service_environment_variable, environment);

		const labels: Dictionary<string> = {};
		for (const { label_name, value } of [
			...ipr.image_label,
			...svc.service_label,
		] as Array<{ label_name: string; value: string }>) {
			labels[label_name] = value;
		}

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

		if (composition?.services?.[svc.service_name] != null) {
			const compositionService = composition.services[svc.service_name];
			// We remove the `build` properly explicitly as it's expected to be present
			// for the builder, but makes no sense for the supervisor to support
			delete compositionService.build;
			services[svc.id] = {
				...compositionService,
				...services[svc.id],
			};
		}
	}

	return {
		releaseId: release.id,
		commit: release.commit,
		name: application.app_name,
		services,
		networks: composition?.networks || {},
		volumes: composition?.volumes || {},
	};
}

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

const getStateV2 = async (req: Request, uuid: string): Promise<StateV2> => {
	const device = await getDevice(req, uuid);
	// At this point we are sure that the api key is valid and not expired.
	events.emit('get-state', uuid, { apiKey: req.apiKey });
	const config = getConfig(device);

	const userApp = getUserAppForState(device, config);
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	const local: StateV2['local'] = {
		name: device.device_name,
		config,
		apps: {
			[userAppFromApi.id]: userApp,
		},
	};

	const dependent = getDependent(device);
	return {
		local,
		dependent,
	};
};

export const stateV2: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

	try {
		res.json(await getStateV2(req, uuid));
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting device state', { req });
		res.status(500).end();
	}
};

const getDevice = async (req: Request, uuid: string) => {
	const device = await readTransaction((tx) =>
		stateQuery()({ uuid }, undefined, { req, tx }),
	);

	if (!device) {
		throw new UnauthorizedError();
	}

	return device;
};

const getConfig = (device: AnyObject) => {
	const config: Dictionary<string> = {};

	// add any app-specific config values...
	const userAppFromApi: AnyObject = device.belongs_to__application[0];
	varListInsert(
		userAppFromApi.application_config_variable,
		config,
		rejectUiConfig,
	);

	// override with device-specific values...
	varListInsert(device.device_config_variable, config, rejectUiConfig);
	filterDeviceConfig(config, device.os_version);
	setDefaultConfigVariables(config);

	return config;
};

const getUserAppForState = (
	device: AnyObject,
	config: Dictionary<string>,
): LocalStateApp => {
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	// get the release of the main app that this device should run...
	const release = getReleaseForDevice(device);

	// grab the main app for this device...
	return release == null
		? {
				name: userAppFromApi.app_name,
				services: {},
				networks: {},
				volumes: {},
		  }
		: buildAppFromRelease(device, userAppFromApi, release, config);
};

const getDependent = (device: AnyObject): StateV2['dependent'] => {
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	const dependendOnByApps =
		userAppFromApi.is_depended_on_by__application as AnyObject[];
	const managesDevice = device.manages__device as AnyObject[];

	const dependentInfo: StateV2['dependent'] = {
		apps: {},
		devices: {},
	};

	const depAppCache: Dictionary<{
		release?: AnyObject;
		application_environment_variable: Array<{
			name: string;
			value: string;
		}>;
	}> = {};

	for (const depApp of dependendOnByApps) {
		const depRelease = depApp?.should_be_running__release?.[0];
		depAppCache[depApp.id] = {
			release: depRelease,
			application_environment_variable: depApp.application_environment_variable,
		};

		const depConfig: Dictionary<string> = {};
		varListInsert(
			depApp.application_config_variable,
			depConfig,
			rejectUiConfig,
		);

		dependentInfo.apps[depApp.id] = {
			name: depApp.app_name,
			parentApp: userAppFromApi.id,
			config: depConfig,
		};

		const image = depRelease?.contains__image?.[0]?.image?.[0];
		if (depRelease != null && image != null) {
			const depAppState = dependentInfo.apps[depApp.id];
			depAppState.releaseId = depRelease.id;
			depAppState.imageId = image.id;
			depAppState.commit = depRelease.commit;
			depAppState.image = formatImageLocation(
				image.is_stored_at__image_location,
			);
		}
	}

	for (const depDev of managesDevice) {
		const depAppId: number = depDev.belongs_to__application.__id;
		const { release: depRelease, application_environment_variable } =
			depAppCache[depAppId];

		const depConfig: Dictionary<string> = {};
		varListInsert(depDev.device_config_variable, depConfig, rejectUiConfig);

		const ipr = depRelease?.contains__image?.[0];
		const image = ipr?.image?.[0];
		const svcInstall = serviceInstallFromImage(depDev, image);

		const environment: Dictionary<string> = {};
		if (ipr != null) {
			varListInsert(ipr.image_environment_variable, environment);
		}

		varListInsert(application_environment_variable, environment);
		if (svcInstall?.service?.[0] != null) {
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

		dependentInfo.devices[depDev.uuid] = {
			name: depDev.device_name,
			apps: {
				[depAppId]: {
					config: depConfig,
					environment,
				},
			},
		};
	}

	return dependentInfo;
};
