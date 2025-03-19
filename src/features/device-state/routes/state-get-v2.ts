import type { RequestHandler, Request } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';
import {
	formatImageLocation,
	readTransaction,
	varListInsert,
	ConfigurationVarsToLabels,
	getStateDelayingEmpty,
	getConfig,
	getStateEventAdditionalFields,
} from '../state-get-utils.js';
import { sbvrUtils } from '@balena/pinejs';
import { events } from '../index.js';
import type { ResolveDeviceInfoCustomObject } from '../middleware.js';
import { getIP } from '../../../lib/utils.js';

const { api } = sbvrUtils;

type CompositionService = AnyObject;
type LocalStateApp = StateV2['local']['apps'][string];
type ExpandedDevice = Awaited<ReturnType<typeof getDevice>>;

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
		// Empty objects since we dropped support for dependent devices
		apps: Record<string, never>;
		devices: Record<string, never>;
	};
};

function buildAppFromRelease(
	device: ExpandedDevice,
	application: ExpandedDevice['belongs_to__application'][number],
	release: ExpandedDevice['should_be_running__release'][number],
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

	const dsevsById = _.groupBy(
		device.device_service_environment_variable,
		({ service }) => service.__id,
	);
	for (const ipr of release.release_image) {
		// extract the per-image information
		const image = ipr.image[0];

		const svc = image.is_a_build_of__service[0];
		const environment: Dictionary<string> = {};
		varListInsert(ipr.image_environment_variable, environment);
		varListInsert(application.application_environment_variable, environment);
		varListInsert(svc.service_environment_variable, environment);
		varListInsert(device.device_environment_variable, environment);
		const dsevs = dsevsById[svc.id];
		if (dsevs != null) {
			varListInsert(dsevs, environment);
		}

		const labels: Dictionary<string> = {};
		for (const { label_name, value } of [
			...ipr.image_label,
			...svc.service_label,
		]) {
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

const stateQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'device',
			id: { uuid: { '@': 'uuid' } },
			options: {
				$select: ['device_name', ...getStateEventAdditionalFields],
				$expand: {
					device_config_variable: {
						$select: ['name', 'value'],
					},
					device_environment_variable: {
						$select: ['name', 'value'],
					},
					// `should_be_running__release` will automatically defer to the app release as necessary
					should_be_running__release: {
						$select: ['id', 'commit', 'composition'],
						$expand: {
							release_image: {
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
					},
					device_service_environment_variable: {
						$select: ['name', 'value', 'service'],
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
						},
					},
				},
			},
		} as const,
		{ uuid: ['string'] },
	),
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
		storedDeviceFields: _.pick(device, getStateEventAdditionalFields),
	});

	const userApp = getUserAppForState(device, config);
	const userAppFromApi = device.belongs_to__application[0];

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
		captureException(err, 'Error getting device state');
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
	device: ExpandedDevice,
	config: Dictionary<string>,
): LocalStateApp => {
	const userAppFromApi = device.belongs_to__application[0];

	// get the release of the main app that this device should run...
	const release = device.should_be_running__release[0];

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
