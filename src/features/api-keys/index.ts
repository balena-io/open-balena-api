import type { Application } from 'express';

import {
	apiKeyMiddleware,
	authorizedMiddleware,
	permissionRequiredMiddleware,
} from '../../infra/auth';
import {
	createDeviceApiKey,
	createGenericApiKey,
	createNamedUserApiKey,
	createProvisioningApiKey,
	createUserApiKey,
} from './routes';

export const setup = (app: Application) => {
	/**
	 * @deprecated this is a legacy api key for very old devices and should not be used any more
	 */
	app.post(
		'/application/:appId/generate-api-key',
		authorizedMiddleware,
		createUserApiKey,
	);
	app.post(
		'/api-key/user/full',
		authorizedMiddleware,
		permissionRequiredMiddleware('auth.create_token'),
		createNamedUserApiKey,
	);
	app.post(
		'/api-key/application/:appId/provisioning',
		authorizedMiddleware,
		createProvisioningApiKey,
	);
	app.post(
		'/api-key/device/:deviceId/device-key',
		apiKeyMiddleware,
		createDeviceApiKey,
	);

	app.post('/api-key/v1', authorizedMiddleware, createGenericApiKey);
};
