import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import { register as register_legacy } from './register_legacy.js';

export const setup = (app: Application) => {
	app.post('/device/register', middleware.authenticatedApiKey, register_legacy);
};
