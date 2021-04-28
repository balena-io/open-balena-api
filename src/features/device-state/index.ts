import type { Application, Request } from 'express';
import type StrictEventEmitter from 'strict-event-emitter-types';

import { EventEmitter } from 'events';
import { apiKeyMiddleware } from '../../infra/auth';

import { gracefullyDenyDeletedDevices } from './middleware';
import { stateV2, stateV3 } from './routes/state';
import { statePatch } from './routes/state-patch';

export const setup = (app: Application) => {
	app.get(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		stateV2,
	);
	app.patch(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		statePatch,
	);

	app.get(
		'/device/v3/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		stateV3,
	);
	app.patch(
		'/device/v3/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		statePatch,
	);
};

export interface Events {
	'get-state': (uuid: string, req: Pick<Request, 'apiKey'>) => void;
}
export const events: StrictEventEmitter<EventEmitter, Events> =
	new EventEmitter();
