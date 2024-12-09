import type { Application } from 'express';

import { middleware } from '../../infra/auth/index.js';
import {
	createDeviceApiKey,
	createGenericApiKey,
	createNamedUserApiKey,
	createProvisioningApiKey,
	createUserApiKey,
} from './routes.js';

export const setup = (app: Application) => {
	/**
	 * @deprecated this is a legacy api key for very old devices and should not be used any more
	 */
	app.post(
		'/application/:appId/generate-api-key',
		middleware.fullyAuthenticatedUser,
		createUserApiKey,
	);
	app.post(
		'/api-key/user/full',
		middleware.fullyAuthenticatedUser,
		middleware.permissionRequired('auth.create_token'),
		createNamedUserApiKey,
	);
	app.post(
		'/api-key/application/:appId/provisioning',
		middleware.fullyAuthenticatedUser,
		createProvisioningApiKey,
	);
	app.post(
		'/api-key/device/:deviceId/device-key',
		middleware.resolveApiKey,
		createDeviceApiKey,
	);

	app.post(
		'/api-key/v1',
		middleware.fullyAuthenticatedUser,
		createGenericApiKey('v1'),
	);

	app.post(
		'/api-key/v2',
		middleware.fullyAuthenticatedUser,
		createGenericApiKey('v2'),
	);
};
