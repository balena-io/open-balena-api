import type { Application } from 'express';

import { middleware } from '../../infra/auth';
import { receiveOnlineDependentDevices } from './receive-online-dependent-devices';

export const setup = (app: Application) => {
	app.post(
		'/dependent/v1/scan',
		middleware.authenticatedApiKey,
		receiveOnlineDependentDevices,
	);
};
