import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.ts';
import { register } from './register.ts';

export const setup = (app: Application) => {
	app.post('/device/register', middleware.authenticatedApiKey, register);
};
