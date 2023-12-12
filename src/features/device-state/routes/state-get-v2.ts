import type { RequestHandler } from 'express';
import type { Request } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import {
	formatImageLocation,
	readTransaction,
	getReleaseForDevice,
	serviceInstallFromImage,
	varListInsert,
	ConfigurationVarsToLabels,
	getStateDelayingEmpty,
	getConfig,
} from '../state-get-utils';
import { sbvrUtils } from '@balena/pinejs';
import { events } from '..';
import { ResolveDeviceInfoCustomObject } from '../middleware';
import { getIP } from '../../../lib/utils';
import { Device } from '../../../balena-model';

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
		apps: {};
		devices: {};
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
			$select: ['device_name', 'public_address'],
			$expand: {
				device_config_variable: {
					$select: ['name', 'value'],
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
						},
						application_environment_variable: {
							$select: ['name', 'value'],
						},
						should_be_running__release: releaseExpand,
					},
				},
			},
		},
	}),
);

const getStateV2 = async (req: Request, uuid: string): Promise<StateV2> => {
	const [deviceId] = (req.custom as ResolveDeviceInfoCustomObject)
		.resolvedDeviceIds;

	const device = await getDevice(req, uuid);
	const config = getConfig(device);
	// At this point we are sure that the api key is valid and not expired.
	events.emit('get-state', deviceId, {
		apiKey: req.apiKey,
		config,
		ipAddress: getIP(req),
		storedPublicAddress: device.public_address as Device['public_address'],
	});

	const userApp = getUserAppForState(device, config);
	const userAppFromApi: AnyObject = device.belongs_to__application[0];

	const local: StateV2['local'] = {
		name: device.device_name,
		config,
		apps: {
			[userAppFromApi.id]: userApp,
		},
	};

	return {
		local,
		dependent: {
			apps: {},
			devices: {},
		},
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

const getDevice = getStateDelayingEmpty(
	async (req, uuid) =>
		await readTransaction((tx) =>
			stateQuery()({ uuid }, undefined, { req, tx }),
		),
);

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
