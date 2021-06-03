import type { RequestHandler } from 'express';
import type { Request } from 'express';

import * as _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import { events } from '..';
import { getStateV3 } from './state-v3';

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (varList: EnvVarList, obj: Dictionary<string>) => {
	varList.forEach((evar) => {
		obj[evar.name] = evar.value;
	});
};

type CompositionService = AnyObject;
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

const getStateV2 = async (req: Request, uuid: string): Promise<StateV2> => {
	const stateV3 = await getStateV3(req, uuid);
	let config = {};
	for (const app of Object.values(stateV3.local.apps)) {
		config = {
			...config,
			...app.config,
		};
	}
	return {
		local: {
			...stateV3.local,
			config,
			apps: _(stateV3.local.apps)
				.mapKeys(({ id }) => id)
				.mapValues(
					({
						name,
						release_uuid: commit,
						release_id: releaseId,
						services = {},
						volumes = {},
						networks = {},
					}) => {
						const v2Services: StateV2['local']['apps'][string]['services'] = {};
						for (const [serviceName, service] of Object.entries(services)) {
							v2Services[service.id] = {
								...service.composition,
								imageId: service.image_id,
								serviceName,
								image: service.image,
								running: service.running ?? true,
								environment: service.environment,
								labels: service.labels,
								contract: service.contract,
							};
						}
						return {
							name,
							commit,
							releaseId,
							services: v2Services,
							volumes,
							networks,
						};
					},
				)
				.value(),
		},
		dependent: {
			apps: _(stateV3.dependent.apps)
				.mapKeys(({ id }) => id)
				.mapValues((app) => {
					return {
						name: app.name,
						parentApp: stateV3.local.apps[app.parent_app].id,
						config: app.config,
						releaseId: app.release_id,
						commit: app.release_uuid,
						imageId: app.image_id,
						image: app.image,
					};
				})
				.value(),
			devices: _.mapValues(stateV3.dependent.devices, ({ name, apps }) => {
				return {
					name,
					apps: _.mapKeys(apps, (_v, appUuid) => {
						return stateV3.dependent.apps[appUuid].id;
					}),
				};
			}),
		},
	};
};

export const stateV2: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

	const { apiKey } = req;
	events.emit('get-state', uuid, { apiKey });

	try {
		res.json(await getStateV2(req, uuid));
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting device state', { req });
		res.sendStatus(500);
	}
};
