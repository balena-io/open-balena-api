import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.ts';
import { proxy } from './device-proxy.ts';

export const setup = (app: Application) => {
	app.post(/^\/supervisor(\/.+)$/, middleware.resolveApiKey, proxy);
};
