import type { Application } from 'express';

import { authorizedMiddleware } from '../../infra/auth';
import { downloadImageConfig } from './download';

export const setup = (app: Application) => {
	app.get('/download-config', authorizedMiddleware, downloadImageConfig);
	app.post('/download-config', authorizedMiddleware, downloadImageConfig);
};
