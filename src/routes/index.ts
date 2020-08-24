import type { Application } from 'express';

import type { SetupOptions } from '../index';
import * as access from '../routes/access';
import * as apiKeys from '../features/api-keys';
import * as deviceConfig from '../features/device-config';
import * as config from '../routes/config';
import * as deviceTypes from '../features/device-types';
import * as osConfig from '../features/os-config';
import * as registry from '../features/registry';
import * as auth from '../features/auth';
import * as dependentDevices from '../features/dependent-devices';
import * as deviceLogs from '../features/device-logs';
import * as deviceState from '../features/device-state';
import * as deviceProvisioning from '../features/device-provisioning';
import * as deviceProxy from '../features/device-proxy';
import * as vpn from '../features/vpn';

import { authorizedMiddleware } from '../infra/auth';

export const setup = (app: Application, onLogin: SetupOptions['onLogin']) => {
	app.get('/config/vars', config.vars);

	auth.setup(app, onLogin);

	deviceProvisioning.setup(app);
	deviceState.setup(app);
	deviceLogs.setup(app);
	dependentDevices.setup(app);
	deviceProxy.setup(app);

	deviceConfig.setup(app);

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
