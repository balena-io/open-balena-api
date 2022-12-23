import type { Application } from 'express';

import { middleware } from '../../infra/auth';
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
		middleware.authorized,
		createUserApiKey,
	);
	app.post(
		'/api-key/user/full',
		middleware.authorized,
		middleware.permissionRequired('auth.create_token'),
		createNamedUserApiKey,
	);
	app.post(
		'/api-key/application/:appId/provisioning',
		middleware.authorized,
		createProvisioningApiKey,
	);
	app.post(
		'/api-key/device/:deviceId/device-key',
		middleware.apiKey,
		createDeviceApiKey,
	);

	app.post('/api-key/v1', middleware.authorized, createGenericApiKey);
};
