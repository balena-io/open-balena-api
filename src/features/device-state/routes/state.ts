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
import * as conf from '../../../lib/config';
import { omit } from 'lodash';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (varList: EnvVarList, obj: Dictionary<string>) => {
	varList.forEach((evar) => {
		obj[evar.name] = evar.value;
	});
};

export type App = {
	name: string;
	commit: string;
	releaseId: number;
	appId?: string;
	uuid?: string;
	type?: 'supervised' | 'supervisor' | 'hostapp' | 'hostapp extension';
	services: {
		[id: number]: AppService;
	};
	volumes: any;
	networks: any;
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

export type LocalState = {
	name: string;
	config: Dictionary<string>;
	apps: Dictionary<Partial<App>>;
	extraContainers?: Dictionary<Partial<App>>;
};

async function buildAppFromRelease(
	device: AnyObject,
	application: AnyObject,
	release: AnyObject,
	config: Dictionary<string>,
): Promise<App> {
	let composition: any = {};
	const services: App['services'] = {};

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

		const serviceInstall = (() => {
			const si = serviceInstallFromImage(device, image);

			if (si != null) {
				return si;
			}

			if (image.is_a_build_of__service[0] == null) {
				throw new Error(
					`Could not find service install for device: '${
						device.uuid
					}', image: '${image?.id}', service: '${JSON.stringify(
						image?.is_a_build_of__service,
					)}', service installs: '${JSON.stringify(device.service_install)}'`,
				);
			}

			/**
			 * Return a fake service install as this is what we will use for Extra Containers / MultiApp
			 */
			return {
				service: [image.is_a_build_of__service[0]],
				device_service_environment_variable: [],
			};
		})();

		/**
		 * Get the first service in the array, which will be tied to a service install OR directlty to an extra container app
		 */
		const [service] = serviceInstall.service;

		const environment: Dictionary<string> = {};
		varListInsert(ipr.image_environment_variable, environment);
		varListInsert(application.application_environment_variable, environment);
		varListInsert(service.service_environment_variable, environment);
		varListInsert(device.device_environment_variable, environment);
		varListInsert(
			serviceInstall.device_service_environment_variable,
			environment,
		);

		const labels: Dictionary<string> = {};
		[...ipr.image_label, ...service.service_label].forEach(
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

		services[service.id] = {
			imageId: image.id,
			serviceName: service.service_name,
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
			services[service.id].contract = image.contract;
		}

		if (
			composition != null &&
			composition.services != null &&
			composition.services[service.service_name] != null
		) {
			const compositionService = composition.services[service.service_name];
			// We remove the `build` properly explicitly as it's expected to be present
			// for the builder, but makes no sense for the supervisor to support
			delete compositionService.build;
			services[service.id] = {
				...compositionService,
				...services[service.id],
			};
		}
	});

	return {
		releaseId: release.id,
		commit: release.commit,
		name: application.app_name,
		services,
		networks: composition?.networks || {},
		volumes: composition?.volumes || {},
	};
}

// These 2 config vars below are mapped to labels if missing for backwards-compatibility
// See: https://github.com/resin-io/hq/issues/1340
const ConfigurationVarsToLabels = {
	RESIN_SUPERVISOR_UPDATE_STRATEGY: 'io.resin.update.strategy',
	RESIN_SUPERVISOR_HANDOVER_TIMEOUT: 'io.resin.update.handover-timeout',
};

const releaseExpand = {
	$select: [
		'id',
		'commit',
		'composition',
		'release_version',
		'belongs_to__application',
	],
	$expand: {
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
	},
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
					$select: ['id', 'app_name', 'uuid', 'install_type'],
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
				should_be_managed_by__release: releaseExpand,
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

		const config: Dictionary<string> = {};

		// add any app-specific config values...
		const parentApp: AnyObject = device.belongs_to__application[0];
		varListInsert(parentApp.application_config_variable, config);

		// override with device-specific values...
		varListInsert(device.device_config_variable, config);
		filterDeviceConfig(config, device.os_version);
		setMinPollInterval(config);

		// get the release of the main app that this device should run...
		const release = getReleaseForDevice(device);

		// grab the main app for this device...
		const mainApp =
			release == null
				? {
						name: parentApp.app_name,
						services: {},
						networks: {},
						volumes: {},
				  }
				: await buildAppFromRelease(device, parentApp, release, config);

		/**
		 * Grab the supervisor version for this device, either:
		 * - the version which should be managing the device
		 * - the version last reported to be managing the device
		 * - empty string
		 */
		const supervisorVersion: string = (() => {
			const [supervisorRelease] = device.should_be_managed_by__release;

			if (supervisorRelease?.release_version != null) {
				return supervisorRelease.release_version;
			}

			return device.supervisor_version ?? '';
		})();

		// grab the system apps for this device...
		let extraContainers =
			conf.EXTRA_CONTAINERS.length === 0
				? []
				: await sbvrUtils.db.readTransaction!(async (tx) => {
						const resinApiTx = api.resin.clone({ passthrough: { req, tx } });
						return await resinApiTx.get({
							resource: 'application',
							options: {
								$select: ['id', 'app_name', 'uuid', 'install_type'],
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
									should_be_running__release: releaseExpand,
								},
								$filter: {
									uuid: {
										$in: conf.EXTRA_CONTAINERS,
									},
									// we'll load supervisors separately since they don't track latest
									install_type: {
										$ne: 'supervisor',
									},
									should_be_running__release: {
										$any: {
											$alias: 'r',
											$expr: {
												r: {
													has__tag_key: {
														$any: {
															$alias: 'rt',
															$expr: {
																rt: {
																	tag_key: {
																		$startswith: 'BALENA_REQUIRED_SUPERVISOR_',
																	},
																	value: supervisorVersion,
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
				  });
		const local: LocalState = {
			name: device.device_name,
			config,
			apps: {
				[parentApp.id]: {
					...mainApp,
					uuid: parentApp.uuid,
					appId: parentApp.id,
					type: parentApp.install_type,
				},
			},
		};
		if (device.should_be_managed_by__release.length !== 0) {
			const supervisorApp =
				(await sbvrUtils.db.readTransaction!(async (tx) => {
					const resinApiTx = api.resin.clone({ passthrough: { req, tx } });
					return await resinApiTx.get({
						resource: 'application',
						id:
							device.should_be_managed_by__release[0].belongs_to__application
								.__id,
						options: {
							$select: ['id', 'app_name', 'uuid', 'install_type'],
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
					});
				})) || {};
			if (supervisorApp) {
				supervisorApp.should_be_running__release =
					device.should_be_managed_by__release;
				extraContainers = [...extraContainers, supervisorApp];
			}
		}

		if (extraContainers.length > 0) {
			local.extraContainers = {};
			for (const app of extraContainers) {
				local.extraContainers[app.uuid] = {
					...(await buildAppFromRelease(
						device,
						app,
						app.should_be_running__release[0],
						config,
					)),
					type: app.install_type,
					appId: app.id,
					uuid: app.uuid,
				};
			}
		}

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

		if (req.headers['x-balena-state-format'] === 'v2+extraContainers') {
			const apps = Object.entries(local.apps).map(([appId, info]) => {
				return [info.uuid, { ...info, appId: parseInt(appId, 10) }];
			});
			const containers = Object.entries(local.extraContainers ?? {}).map(
				([appUuid, info]) => {
					return [appUuid, { ...info, uuid: appUuid }];
				},
			);

			delete local.extraContainers;
			local.apps = Object.fromEntries([...apps, ...containers]);
		} else {
			const apps = Object.entries(local.apps).map(([appId, info]) => {
				return [appId, omit(info, ['appId', 'type', 'uuid'])];
			});

			local.apps = Object.fromEntries(apps);
		}

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
