import type { Application } from 'express';

import { apiKeyMiddleware } from '../../infra/auth';

import {
	gracefullyDenyDeletedDevices,
	registerDeviceStateEvent,
} from './middleware';
import { state } from './routes/state';
import { statePatch } from './routes/state-patch';

export const setup = (app: Application) => {
	app.get(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		registerDeviceStateEvent('params.uuid'),
		state,
	);
	app.patch(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		statePatch,
	);
};
