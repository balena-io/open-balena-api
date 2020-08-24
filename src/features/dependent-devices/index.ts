import type { Application } from 'express';

import { apiKeyMiddleware } from '../../infra/auth';
import { receiveOnlineDependentDevices } from './receive-online-dependent-devices';

export const setup = (app: Application) => {
	app.post(
		'/dependent/v1/scan',
		apiKeyMiddleware,
		receiveOnlineDependentDevices,
	);
};
