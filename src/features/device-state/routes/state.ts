import type { RequestHandler } from 'express';
import type { Request } from 'express';

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
import { ApplicationEnvironmentVariable } from '../../../balena-model';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (varList: EnvVarList, obj: Dictionary<string>) => {
	varList.forEach((evar) => {
		obj[evar.name] = evar.value;
	});
};

export interface AppV2 {
	name: string;
	commit: string;
	releaseId: number;
	services: {
		[id: number]: AppService;
	};
	volumes: AnyObject;
	networks: AnyObject;
}

export interface AppV3 extends AppV2 {
	appId: string;
	uuid: string;
	releaseVersion: string;
}

export type Dependent = {
	apps: AnyObject;
	devices: AnyObject;
};

export type AppService = {
	imageId: number;
	serviceName: string;
	image: string;
	running: boolean;
	environment: Dictionary<string>;
	labels: Dictionary<string>;
	contract?: string;
};

export type LocalStateV2 = {
	name: string;
	config: Dictionary<string>;
	apps: Dictionary<Partial<AppV2>>;
};

export type LocalStateV3 = {
	name: string;
	config: Dictionary<string>;
	apps: Dictionary<AppV3>;
};

export type ResponseV2 = {
	local: LocalStateV2;
	dependent: Dependent;
};

export type ResponseV3 = {
	local: LocalStateV3;
	dependent: Dependent;
};

function buildAppFromRelease(
	device: AnyObject,
	application: AnyObject,
	release: AnyObject,
	config: Dictionary<string>,
): AppV3 {
	let composition: AnyObject = {};
	const services: AppV3['services'] = {};

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

	(release.contains__image as AnyObject[]).forEach((ipr) => {
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
	});

	return {
		appId: application.id,
		uuid: application.uuid,
		releaseId: release.id,
		releaseVersion: release.release_version,
		commit: release.commit,
		name: application.app_name,
		services,
		networks: composition?.networks ?? {},
		volumes: composition?.volumes ?? {},
	};
}

// These 2 config vars below are mapped to labels if missing for backwards-compatibility
// See: https://github.com/resin-io/hq/issues/1340
const ConfigurationVarsToLabels = {
	RESIN_SUPERVISOR_UPDATE_STRATEGY: 'io.resin.update.strategy',
	RESIN_SUPERVISOR_HANDOVER_TIMEOUT: 'io.resin.update.handover-timeout',
};

const releaseSelect = [
	'id',
	'commit',
	'composition',
	'release_version',
	'belongs_to__application',
];

const releaseExpand = {
	has__tag_key: {
		$select: ['tag_key', 'value'],
	},
	contains__image: {
		$select: 'id',
		$expand: {
			image: {
				$select: [
					'id',
					'is_stored_at__image_location',
					'content_hash',
					'contract',
				],
				$expand: {
					is_a_build_of__service: {
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
				},
			},
			image_label: {
				$select: ['label_name', 'value'],
			},
			image_environment_variable: {
				$select: ['name', 'value'],
			},
		},
	},
};

const releaseOdataQuery = {
	$select: releaseSelect,
	$expand: releaseExpand,
};

const stateQuery = _.once(() =>
	api.resin.prepare<{ uuid: string }>({
		resource: 'device',
		id: { uuid: { '@': 'uuid' } },
		options: {
			$select: ['device_name', 'os_version', 'supervisor_version'],
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
				should_be_running__release: releaseOdataQuery,
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
					$select: ['id', 'app_name', 'uuid'],
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
								should_be_running__release: releaseOdataQuery,
							},
						},
						should_be_running__release: releaseOdataQuery,
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
				should_be_managed_by__release: {
					$select: releaseSelect,
					$expand: {
						...releaseExpand,
						belongs_to__application: {
							$select: ['id', 'app_name', 'uuid'],
							$expand: {
								application_config_variable: {
									$select: ['name', 'value'],
									$orderby: {
										name: 'asc',
									},
								},
								application_environment_variable: {
									$select: ['name', 'value'],
									$orderby: {
										name: 'asc',
									},
								},
							},
						},
					},
				},
			},
		},
	}),
);

export const stateV2: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

	const { apiKey } = req;
	events.emit('get-state', uuid, { apiKey });

	try {
		const device = await getDevice(req, uuid);
		const config = getConfig(device) ?? {};

		const appsForState: Dictionary<AppV2> = {};

		const userApp = getUserAppForState(device, config);
		if (userApp) {
			const userAppV2: AppV2 = {
				commit: userApp.commit,
				name: userApp.name,
				releaseId: userApp.releaseId,
				networks: userApp.networks,
				services: userApp.services,
				volumes: userApp.volumes,
			};
			appsForState[userApp.appId] = userAppV2;
		}

		const local: LocalStateV2 = {
			name: device.device_name ?? '',
			config,
			apps: appsForState,
		};

		const dependent = getDependent(device);

		res.json({
			local,
			dependent,
		} as ResponseV2);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting device state', { req });
		res.sendStatus(500);
	}
};

export const stateV3: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

	const { apiKey } = req;
	events.emit('get-state', uuid, { apiKey });

	try {
		const device = await getDevice(req, uuid);
		const config = getConfig(device);

		const appsForState: Dictionary<AppV3> = {};

		const userApp = getUserAppForState(device, config);
		if (userApp) {
			appsForState[userApp.uuid] = userApp;
		}

		const supervisorApp = getSupervisorAppForState(device, config);
		if (supervisorApp) {
			appsForState[supervisorApp.uuid!] = supervisorApp;
		}

		const local: LocalStateV3 = {
			name: device.device_name,
			config,
			apps: appsForState,
		};

		const dependent = getDependent(device);

		res.json({
			local,
			dependent,
		} as ResponseV3);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting device state', { req });
		res.sendStatus(500);
	}
};

const getDevice = async (req: Request, uuid: string) => {
	const device = await sbvrUtils.db.readTransaction!((tx) =>
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
	varListInsert(userAppFromApi.application_config_variable, config);

	// override with device-specific values...
	varListInsert(device.device_config_variable, config);
	filterDeviceConfig(config, device.os_version);
	setMinPollInterval(config);

	return config;
};

const getUserAppForState = (
	device: AnyObject,
	config: Dictionary<string>,
): AppV3 => {
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	// get the release of the main app that this device should run...
	const release = getReleaseForDevice(device);

	// grab the main app for this device...
	return release == null
		? ({
				name: userAppFromApi.app_name,
				appId: userAppFromApi.id,
				uuid: userAppFromApi.uuid,
				services: {},
				networks: {},
				volumes: {},
		  } as AppV3)
		: buildAppFromRelease(device, userAppFromApi, release, config);
};

const getSupervisorAppForState = (
	device: AnyObject,
	config: Dictionary<string>,
): AppV3 | null => {
	const deviceManagedByRelease = device?.should_be_managed_by__release?.[0];
	const deviceManagedByApplication =
		deviceManagedByRelease?.belongs_to__application?.[0];
	if (!deviceManagedByApplication) {
		return null;
	}

	const fromApi = {
		id: deviceManagedByApplication.id,
		app_name: deviceManagedByApplication.app_name,
		uuid: deviceManagedByApplication.uuid,
		application_config_variable:
			deviceManagedByApplication.application_config_variable,
		application_environment_variable:
			deviceManagedByApplication.application_environment_variable,
		should_be_running__release: deviceManagedByRelease,
	};

	return buildAppFromRelease(
		device,
		fromApi,
		device.should_be_managed_by__release[0],
		config,
	);
};

const getDependent = (device: AnyObject): Dependent => {
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	const dependendOnByApps =
		userAppFromApi.is_depended_on_by__application as AnyObject[];
	const managesDevice = device.manages__device as AnyObject[];

	const dependentInfo: Dependent = {
		apps: {},
		devices: {},
	};

	const depAppCache: Dictionary<{
		release?: AnyObject;
		application_environment_variable: Array<
			Pick<ApplicationEnvironmentVariable, 'name' | 'value'>
		>;
	}> = {};

	dependendOnByApps.forEach((depApp) => {
		const depRelease = depApp?.should_be_running__release?.[0];
		depAppCache[depApp.id] = {
			release: depRelease,
			application_environment_variable: depApp.application_environment_variable,
		};

		const depConfig: Dictionary<string> = {};
		varListInsert(depApp.application_config_variable, depConfig);

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
	});

	managesDevice.forEach((depDev) => {
		const depAppId: number = depDev.belongs_to__application.__id;
		const { release: depRelease, application_environment_variable } =
			depAppCache[depAppId];

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
	});

	return dependentInfo;
};
