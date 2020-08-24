import type { Application } from 'express';

import { apiKeyMiddleware } from '../../infra/auth';
import { proxy } from './device-proxy';

export const setup = (app: Application) => {
	app.post(/^\/supervisor(\/.+)$/, apiKeyMiddleware, proxy);
};
