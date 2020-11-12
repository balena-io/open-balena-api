import type { Application, Request } from 'express';
import type StrictEventEmitter from 'strict-event-emitter-types';

import { EventEmitter } from 'events';
import { apiKeyMiddleware } from '../../infra/auth';

import { gracefullyDenyDeletedDevices } from './middleware';
import { state } from './routes/state';
import { statePatch } from './routes/state-patch';

export const setup = (app: Application) => {
	app.get(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		state,
	);
	app.get(
		'/device/v2ec/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		async function (req, res, next) {
			req.headers['x-balena-state-format'] = 'v2+extraContainers';
			return state(req, res, next);
		},
	);
	app.patch(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		statePatch,
	);
};

export interface Events {
	'get-state': (uuid: string, req: Pick<Request, 'apiKey'>) => void;
}
export const events: StrictEventEmitter<
	EventEmitter,
	Events
> = new EventEmitter();
