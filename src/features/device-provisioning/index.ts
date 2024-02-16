import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import { register } from './register.js';

export const setup = (app: Application) => {
	app.post('/device/register', middleware.authenticatedApiKey, register);
};
