import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import { downloadImageConfig } from './download.js';

export const setup = (app: Application) => {
	app.get(
		'/download-config',
		middleware.fullyAuthenticatedUser,
		downloadImageConfig,
	);
	app.post(
		'/download-config',
		middleware.fullyAuthenticatedUser,
		downloadImageConfig,
	);
};
