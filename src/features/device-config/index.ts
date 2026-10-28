import type { Application, RequestHandler } from 'express';

import { middleware } from '../../infra/auth/index.ts';
import { downloadImageConfig } from './download.ts';

export const setup = (app: Application) => {
	app.get(
		'/download-config',
		middleware.fullyAuthenticatedUser as RequestHandler,
		downloadImageConfig,
	);
	app.post(
		'/download-config',
		middleware.fullyAuthenticatedUser as RequestHandler,
		downloadImageConfig,
	);
};
