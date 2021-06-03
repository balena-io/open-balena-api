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

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (
	varList: EnvVarList,
	obj: Dictionary<string>,
	filterFn: (name: string) => boolean = () => true,
) => {
	varList.forEach(({ name, value }) => {
		if (filterFn(name)) {
			obj[name] = value;
		}
	});
};
export const rejectUiConfig = (name: string) =>
	!/^(BALENA|RESIN)_UI/.test(name);

type LocalStateApp = StateV3['local']['apps'][string];
type ServiceComposition = AnyObject;
type SharedApp = {
	/**
	 * @deprecated to be removed in state v4
	 */
	id: number;
	name: string;
	is_host?: boolean;
	/**
	 * @deprecated to be removed in state v4
	 */
	release_id?: number;
	release_uuid?: string;
	config: {
		[varName: string]: string;
	};
};
export type StateV3 = {
	local: {
		name: string;
		apps: {
			[uuid: string]: SharedApp & {
				services?: {
					[name: string]: {
						/**
						 * @deprecated to be removed in state v4
						 */
						id: number;
						/**
						 * @deprecated to be removed in state v4
						 */
						image_id: number;
						image: string;
						/**
						 * Defaults to true if undefined
						 */
						running?: boolean;
						environment: {
							[varName: string]: string;
						};
						labels: {
							[labelName: string]: string;
						};
						contract?: AnyObject;
						composition?: ServiceComposition;
					};
				};
				volumes?: AnyObject;
				networks?: AnyObject;
			};
		};
	};
	dependent: {
		apps: {
			[uuid: string]: SharedApp & {
				parent_app: string;
				/**
				 * @deprecated to be removed in state v4
				 */
				image_id?: number;
				image?: string;
			};
		};
		devices: {
			[uuid: string]: {
				name: string;
				apps: {
					[uuid: string]: {
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
	release: AnyObject | undefined,
	config: Dictionary<string>,
	stateApp: LocalStateApp,
): LocalStateApp {
	if (release == null) {
		return stateApp;
	}
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

		services[svc.service_name] = {
			id: svc.id,
			image_id: image.id,
			image: formatImageLocation(imgRegistry),
			environment,
			labels,
		};
		// Don't send a null contract as this is a waste
		// of bandwidth (a null contract is the same as
		// the lack of a contract field)
		if (image.contract != null) {
			services[svc.service_name].contract = image.contract;
		}

		if (composition?.services?.[svc.service_name] != null) {
			const compositionService = composition.services[svc.service_name];
			// We remove the `build` properly explicitly as it's expected to be present
			// for the builder, but makes no sense for the supervisor to support
			delete compositionService.build;
			services[svc.service_name].composition = compositionService;
		}
	});

	stateApp.release_id = release.id;
	stateApp.release_uuid = release.commit;
	if (composition.networks != null) {
		stateApp.networks = composition.networks;
	}
	if (composition.volumes != null) {
		stateApp.volumes = composition.volumes;
	}
	if (Object.keys(services).length > 0) {
		stateApp.services = services;
	}
	return stateApp;
}

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

const appExpand = {
	application_environment_variable: {
		$select: ['name', 'value'],
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
					$select: ['id', 'uuid', 'app_name', 'is_host'],
					$expand: {
						...appExpand,
						application_config_variable: {
							$select: ['name', 'value'],
							$orderby: {
								name: 'asc',
							},
						},
						is_depended_on_by__application: {
							$select: ['id', 'uuid', 'app_name', 'is_host'],
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
				should_be_managed_by__release: {
					...releaseExpand,
					$expand: {
						...releaseExpand.$expand,
						belongs_to__application: {
							$select: ['id', 'uuid', 'app_name', 'is_host'],
							$expand: appExpand,
						},
					},
				},
			},
		},
	}),
);

export const getStateV3 = async (
	req: Request,
	uuid: string,
): Promise<StateV3> => {
	const device = await getDevice(req, uuid);
	const config = getConfig(device);

	let apps = getUserAppState(device, config);

	const supervisorRelease = device.should_be_managed_by__release?.[0];
	if (supervisorRelease) {
		apps = {
			...getSupervisorAppState(device, config),
			...apps,
		};
	}

	const local: StateV3['local'] = {
		name: device.device_name,
		apps,
	};

	const dependent = getDependent(device);
	return {
		local,
		dependent,
	};
};

export const stateV3: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

	const { apiKey } = req;
	events.emit('get-state', uuid, { apiKey });

	try {
		const state = await getStateV3(req, uuid);
		// if(Object.keys(state.local.apps).length < 3) {
		// 	throw new InternalRequestError('Missing supervisor/host os app')
		// }
		res.json(state);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting device state', { req });
		res.status(500).end();
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
	varListInsert(
		userAppFromApi.application_config_variable,
		config,
		rejectUiConfig,
	);

	// override with device-specific values...
	varListInsert(device.device_config_variable, config, rejectUiConfig);
	filterDeviceConfig(config, device.os_version);
	setMinPollInterval(config);

	return config;
};

const getAppState = (
	device: AnyObject,
	application: AnyObject,
	release: AnyObject | undefined,
	config: Dictionary<string>,
): StateV3['local']['apps'] => {
	return {
		[application.uuid]: buildAppFromRelease(
			device,
			application,
			release,
			config,
			{
				id: application.id,
				name: application.app_name,
				is_host: application.is_host,
				config,
			},
		),
	};
};

const getUserAppState = (
	device: AnyObject,
	config: Dictionary<string>,
): StateV3['local']['apps'] => {
	const userApp = device.belongs_to__application[0];
	const userAppRelease = getReleaseForDevice(device);
	return getAppState(device, userApp, userAppRelease, config);
};
const getSupervisorAppState = (
	device: AnyObject,
	config: Dictionary<string>,
): StateV3['local']['apps'] => {
	const supervisorRelease = device.should_be_managed_by__release[0];
	if (!supervisorRelease) {
		return {};
	}
	const supervisorApp = supervisorRelease.belongs_to__application[0];
	return getAppState(device, supervisorApp, supervisorRelease, config);
};

const getDependent = (device: AnyObject): StateV3['dependent'] => {
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	const dependendOnByApps =
		userAppFromApi.is_depended_on_by__application as AnyObject[];
	const managesDevice = device.manages__device as AnyObject[];

	const dependentInfo: StateV3['dependent'] = {
		apps: {},
		devices: {},
	};

	const depAppCache: Dictionary<{
		release?: AnyObject;
		application_environment_variable: Array<{
			name: string;
			value: string;
		}>;
		uuid: string;
	}> = {};

	dependendOnByApps.forEach((depApp) => {
		const depRelease = depApp?.should_be_running__release?.[0];
		depAppCache[depApp.id] = {
			release: depRelease,
			application_environment_variable: depApp.application_environment_variable,
			uuid: depApp.uuid,
		};

		const depConfig: Dictionary<string> = {};
		varListInsert(
			depApp.application_config_variable,
			depConfig,
			rejectUiConfig,
		);

		dependentInfo.apps[depApp.uuid] = {
			id: depApp.id,
			name: depApp.app_name,
			is_host: depApp.is_host,
			parent_app: userAppFromApi.uuid,
			config: depConfig,
		};

		const image = depRelease?.contains__image?.[0]?.image?.[0];
		if (depRelease != null && image != null) {
			const depAppState = dependentInfo.apps[depApp.uuid];
			depAppState.release_id = depRelease.id;
			depAppState.image_id = image.id;
			depAppState.release_uuid = depRelease.commit;
			depAppState.image = formatImageLocation(
				image.is_stored_at__image_location,
			);
		}
	});

	managesDevice.forEach((depDev) => {
		const depAppId: number = depDev.belongs_to__application.__id;
		const {
			release: depRelease,
			application_environment_variable,
			uuid: depAppUuid,
		} = depAppCache[depAppId];

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
				[depAppUuid]: {
					config: depConfig,
					environment,
				},
			},
		};
	});

	return dependentInfo;
};
