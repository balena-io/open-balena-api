import type { Application } from 'express';

import type { SetupOptions } from '../index';
import * as access from '../routes/access';
import * as apiKeys from '../features/api-keys';
import * as applications from '../routes/applications';
import * as config from '../routes/config';
import * as deviceTypes from '../features/device-types';
import * as devices from '../routes/devices';
import * as osConfig from '../features/os-config';
import * as registry from '../features/registry';
import * as auth from '../features/auth';
import * as deviceLogs from '../features/device-logs';
import * as deviceState from '../features/device-state';
import * as deviceProxy from '../features/device-proxy';
import * as vpn from '../features/vpn';

import { apiKeyMiddleware, authorizedMiddleware } from '../infra/auth';

export const setup = (app: Application, onLogin: SetupOptions['onLogin']) => {
	app.get('/config/vars', config.vars);

	auth.setup(app, onLogin);

	app.post('/device/register', apiKeyMiddleware, devices.register);
	deviceState.setup(app);
	deviceLogs.setup(app);
	app.post(
		'/dependent/v1/scan',
		apiKeyMiddleware,
		devices.receiveOnlineDependentDevices,
	);
	deviceProxy.setup(app);

	app.get(
		'/download-config',
		authorizedMiddleware,
		applications.downloadImageConfig,
	);
	app.post(
		'/download-config',
		authorizedMiddleware,
		applications.downloadImageConfig,
	);

	apiKeys.setup(app);

	vpn.setup(app);

	registry.setup(app);

	app.get(
		'/access/v1/hostos/:device_uuid',
		authorizedMiddleware,
		access.hostOSAccess,
	);

	deviceTypes.setup(app);
	osConfig.setup(app);
};
