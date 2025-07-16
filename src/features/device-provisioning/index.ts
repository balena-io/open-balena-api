import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import { register as register_legacy } from './register_legacy.js';
import { register } from './register.js';

export const setup = (app: Application) => {
	app.post('/device/v3/register', middleware.authenticatedApiKey, register);
	app.post('/device/register', middleware.authenticatedApiKey, register_legacy);
};
