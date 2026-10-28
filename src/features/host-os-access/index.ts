import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.ts';
import { hostOSAccess } from './access.ts';

export const setup = (app: Application) => {
	app.get(
		'/access/v1/hostos/:device_uuid',
		middleware.fullyAuthenticatedUser,
		hostOSAccess,
	);
};
