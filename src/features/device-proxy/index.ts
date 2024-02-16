import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import { proxy } from './device-proxy.js';

export const setup = (app: Application) => {
	app.post(/^\/supervisor(\/.+)$/, middleware.resolveApiKey, proxy);
};
