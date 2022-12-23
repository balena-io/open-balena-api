import type { Application } from 'express';

import { middleware } from '../../infra/auth';
import { hostOSAccess } from './access';

export const setup = (app: Application) => {
	app.get(
		'/access/v1/hostos/:device_uuid',
		middleware.authorized,
		hostOSAccess,
	);
};
