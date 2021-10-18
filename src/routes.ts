import type { Application } from 'express';
import type { SetupOptions } from './index';

import * as hostOSAccess from './features/host-os-access';
import * as apiKeys from './features/api-keys';
import * as deviceConfig from './features/device-config';
import * as varsSchema from './features/vars-schema';
import * as deviceTypes from './features/device-types';
import * as osConfig from './features/os-config';
import * as registry from './features/registry';
import * as auth from './features/auth';
import * as dependentDevices from './features/dependent-devices';
import * as deviceLogs from './features/device-logs';
import * as deviceState from './features/device-state';
import * as deviceProvisioning from './features/device-provisioning';
import * as deviceProxy from './features/device-proxy';
import * as vpn from './features/vpn';

export const setup = (
	app: Application,
	{ onLogin, onLogWriteStreamInitialized }: SetupOptions,
) => {
	varsSchema.setup(app);
	auth.setup(app, onLogin);
	deviceProvisioning.setup(app);
	deviceState.setup(app);
	deviceLogs.setup(app, onLogWriteStreamInitialized);
	dependentDevices.setup(app);
	deviceProxy.setup(app);
	deviceConfig.setup(app);
	apiKeys.setup(app);
	vpn.setup(app);
	registry.setup(app);
	hostOSAccess.setup(app);
	deviceTypes.setup(app);
	osConfig.setup(app);
};
