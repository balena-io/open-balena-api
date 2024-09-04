import type { RequestHandler, Request } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';
import {
	ConfigurationVarsToLabels,
	formatImageLocation,
	getConfig,
	getStateDelayingEmpty,
	getStateEventAdditionalFields,
	readTransaction,
	serviceInstallFromImage,
	varListInsert,
} from '../state-get-utils.js';
import { sbvrUtils } from '@balena/pinejs';
import { events } from '../index.js';
import type { ResolveDeviceInfoCustomObject } from '../middleware.js';
import { getIP } from '../../../lib/utils.js';

const { api } = sbvrUtils;

type LocalStateApp = StateV3[string]['apps'][string];
type ServiceComposition = AnyObject;
export type StateV3 = {
	[uuid: string]: {
		name: string;
		config?: {
			[varName: string]: string;
		};
		apps: {
			[uuid: string]: {
				/**
				 * @deprecated to be removed in state v4
				 */
				id: number;
				name: string;
				class: 'fleet' | 'block' | 'app';
				is_host?: boolean;
				releases?: {
					[uuid: string]: {
						/**
						 * @deprecated to be removed in state v4
						 */
						id: number;
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
		};
	};
};

export function buildAppFromRelease(
	device: AnyObject | undefined,
	application: AnyObject,
	release: AnyObject,
	config: Dictionary<string>,
	defaultLabels?: Dictionary<string>,
): NonNullable<LocalStateApp['releases']> {
	let composition: AnyObject = {};
	const services: NonNullable<LocalStateApp['releases']>[string]['services'] =
		{};

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

		const si = serviceInstallFromImage(device ?? application, image);
		if (si == null) {
			throw new Error(
				`Could not find service install for device or application: '${
					application.uuid
				}', image: '${image?.id}', service: '${JSON.stringify(
					image?.is_a_build_of__service,
				)}', service: '${
					device
						? JSON.stringify(device.service_install)
						: JSON.stringify(application.service)
				}'`,
			);
		}
		const svc = si.service?.[0] ?? si;
		const environment: Dictionary<string> = {};
		varListInsert(ipr.image_environment_variable, environment);
		varListInsert(application.application_environment_variable, environment);
		varListInsert(svc.service_environment_variable, environment);

		if (device?.device_environment_variable) {
			varListInsert(device.device_environment_variable, environment);
		}
		if (si?.device_service_environment_variable) {
			varListInsert(si.device_service_environment_variable, environment);
		}

		const labels: Dictionary<string> = {
			...defaultLabels,
		};
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
	}

	return {
		[release.commit]: {
			id: release.id,
			...(Object.keys(services).length > 0 ? { services } : undefined),
			...(composition.networks != null && { networks: composition.networks }),
			...(composition.volumes != null && { volumes: composition.volumes }),
		},
	};
}

export const releaseExpand = {
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
} as const;

const appExpand = {
	application_environment_variable: {
		$select: ['name', 'value'],
	},
} as const;
const deviceExpand = {
	device_config_variable: {
		$select: ['name', 'value'],
	},
	device_environment_variable: {
		$select: ['name', 'value'],
	},
	// `should_be_running__release` will automatically defer to the app release as necessary
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
		$select: ['id', 'uuid', 'app_name', 'is_host', 'is_of__class'],
		$expand: {
			...appExpand,
			application_config_variable: {
				$select: ['name', 'value'],
			},
		},
	},
	should_be_managed_by__release: {
		...releaseExpand,
		$expand: {
			...releaseExpand.$expand,
			belongs_to__application: {
				$select: ['id', 'uuid', 'app_name', 'is_host', 'is_of__class'],
				$expand: appExpand,
			},
		},
	},
	should_be_operated_by__release: {
		...releaseExpand,
		$expand: {
			...releaseExpand.$expand,
			belongs_to__application: {
				$select: ['id', 'uuid', 'app_name', 'is_host', 'is_of__class'],
				$expand: appExpand,
			},
		},
	},
} as const;

const stateQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'device',
			id: { uuid: { '@': 'uuid' } },
			options: {
				$select: ['device_name', ...getStateEventAdditionalFields],
				$expand: deviceExpand,
			},
		} as const,
		{ uuid: ['string'] },
	),
);

const getStateV3 = async (req: Request, uuid: string): Promise<StateV3> => {
	const [deviceId] = (req.custom as ResolveDeviceInfoCustomObject)
		.resolvedDeviceIds;

	const device = await getDevice(req, uuid);
	const config = getConfig(device);
	// At this point we are sure that the api key is valid and not expired.
	events.emit('get-state', deviceId, {
		apiKey: req.apiKey,
		config,
		ipAddress: getIP(req),
		storedDeviceFields: _.pick(device, getStateEventAdditionalFields),
	});

	// We use an empty config for the supervisor & hostApp as we don't want any labels applied to them due to user app config
	const svAndHostAppConfig = {};
	const apps = {
		...getAppState(device, 'should_be_managed_by__release', svAndHostAppConfig),
		...getAppState(
			device,
			'should_be_operated_by__release',
			svAndHostAppConfig,
			{
				// This label is necessary for older supervisors to properly detect the hostApp
				// and ignore it, sinc `is_host: true` wasn't enough. W/o this the device would
				// try to install the hostApp container like a normal user app and restart it
				// constantly b/c the image doesn't have a CMD specified.
				// See: https://github.com/balena-os/balena-supervisor/blob/v15.2.0/src/compose/app.ts#L839
				'io.balena.image.store': 'root',
			},
		),
		...getAppState(device, 'should_be_running__release', config),
	};

	const state: StateV3 = {
		[uuid]: {
			name: device.device_name!,
			apps,
			config,
		},
	};

	return state;
};

export const stateV3: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

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

const getDevice = getStateDelayingEmpty(
	async (req, uuid) =>
		await readTransaction((tx) =>
			stateQuery()({ uuid }, undefined, { req, tx }),
		),
);

const getAppState = (
	device: AnyObject,
	targetReleaseField:
		| 'should_be_running__release'
		| 'should_be_managed_by__release'
		| 'should_be_operated_by__release',
	config: Dictionary<string>,
	defaultLabels?: Dictionary<string>,
): StateV3[string]['apps'] | null => {
	let application: AnyObject;
	let release: AnyObject | undefined;
	if (targetReleaseField === 'should_be_running__release') {
		application = device.belongs_to__application[0];
		release = device.should_be_running__release[0];
	} else {
		release = device[targetReleaseField][0];
		if (!release) {
			return null;
		}
		application = release.belongs_to__application[0];
	}

	return {
		[application.uuid]: {
			id: application.id,
			name: application.app_name,
			is_host: application.is_host,
			class: application.is_of__class,
			...(release != null && {
				releases: buildAppFromRelease(
					device,
					application,
					release,
					config,
					defaultLabels,
				),
			}),
		},
	};
};
