import type { Application } from 'express';
import type { SetupOptions } from './index.ts';

import * as hostOSAccess from './features/host-os-access/index.ts';
import * as apiKeys from './features/api-keys/index.ts';
import * as deviceConfig from './features/device-config/index.ts';
import * as varsSchema from './features/vars-schema/index.ts';
import * as deviceTypes from './features/device-types/index.ts';
import * as osConfig from './features/os-config/index.ts';
import * as registry from './features/registry/index.ts';
import * as auth from './features/auth/index.ts';
import * as deviceLogs from './features/device-logs/index.ts';
import * as deviceState from './features/device-state/index.ts';
import * as deviceProvisioning from './features/device-provisioning/index.ts';
import * as deviceProxy from './features/device-proxy/index.ts';
import * as vpn from './features/vpn/index.ts';

export const setup = (
	app: Application,
	{
		onLogin,
		onRefreshToken,
		onLogWriteStreamInitialized,
		onLogReadStreamInitialized,
	}: SetupOptions,
) => {
	varsSchema.setup(app);
	auth.setup(app, onLogin, onRefreshToken);
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
