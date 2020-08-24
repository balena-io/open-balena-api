import type { Application } from 'express';

import { apiKeyMiddleware } from '../../infra/auth';
import { register } from './register';

export const setup = (app: Application) => {
	app.post('/device/register', apiKeyMiddleware, register);
};
