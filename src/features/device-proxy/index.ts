import type { Application } from 'express';

import { middleware } from '../../infra/auth';
import { proxy } from './device-proxy';

export const setup = (app: Application) => {
	app.post(/^\/supervisor(\/.+)$/, middleware.resolveApiKey, proxy);
};
