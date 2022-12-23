import type { Application } from 'express';

import { middleware } from '../../infra/auth';
import { downloadImageConfig } from './download';

export const setup = (app: Application) => {
	app.get('/download-config', middleware.authorized, downloadImageConfig);
	app.post('/download-config', middleware.authorized, downloadImageConfig);
};
