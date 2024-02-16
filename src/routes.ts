import type { Application } from 'express';
import type { SetupOptions } from './index.js';

import * as hostOSAccess from './features/host-os-access/index.js';
import * as apiKeys from './features/api-keys/index.js';
import * as deviceConfig from './features/device-config/index.js';
import * as varsSchema from './features/vars-schema/index.js';
import * as deviceTypes from './features/device-types/index.js';
import * as osConfig from './features/os-config/index.js';
import * as registry from './features/registry/index.js';
import * as auth from './features/auth/index.js';
import * as deviceLogs from './features/device-logs/index.js';
import * as deviceState from './features/device-state/index.js';
import * as deviceProvisioning from './features/device-provisioning/index.js';
import * as deviceProxy from './features/device-proxy/index.js';
import * as vpn from './features/vpn/index.js';

export const setup = (
	app: Application,
	{
		onLogin,
		onLogWriteStreamInitialized,
		onLogReadStreamInitialized,
	}: SetupOptions,
) => {
	varsSchema.setup(app);
	auth.setup(app, onLogin);
	deviceProvisioning.setup(app);
	deviceState.setup(app);
	deviceLogs.setup(
		app,
		onLogWriteStreamInitialized,
		onLogReadStreamInitialized,
	);
	deviceProxy.setup(app);
	deviceConfig.setup(app);
	apiKeys.setup(app);
	vpn.setup(app);
	registry.setup(app);
	hostOSAccess.setup(app);
	deviceTypes.setup(app);
	osConfig.setup(app);
};
