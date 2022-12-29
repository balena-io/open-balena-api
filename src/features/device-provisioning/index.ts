import type { Application } from 'express';

import { middleware } from '../../infra/auth';
import { register } from './register';

export const setup = (app: Application) => {
	app.post('/device/register', middleware.authenticatedApiKey, register);
};
