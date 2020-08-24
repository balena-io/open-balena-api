import type { Application } from 'express';
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
	app.patch(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		statePatch,
	);
};

export interface Events {
	'get-state': (uuid: string) => void;
}
export const events: StrictEventEmitter<
	EventEmitter,
	Events
> = new EventEmitter();
