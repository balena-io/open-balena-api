import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import { hostOSAccess } from './access.js';

export const setup = (app: Application) => {
	app.get(
		'/access/v1/hostos/:device_uuid',
		middleware.fullyAuthenticatedUser,
		hostOSAccess,
	);
};
