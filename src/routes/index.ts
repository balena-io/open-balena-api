import type { Application } from 'express';

import {
	gracefullyDenyDeletedDevices,
	registerDeviceStateEvent,
} from '../platform/middleware';

import type { SetupOptions } from '../index';
import * as access from '../routes/access';
import * as apiKeys from '../routes/api-keys';
import * as applications from '../routes/applications';
import * as config from '../routes/config';
import * as deviceTypes from '../routes/device-types';
import * as devices from '../routes/devices';
import * as os from '../routes/os';
import * as registry from '../routes/registry';
import * as services from '../routes/services';
import * as auth from '../features/auth';
import * as deviceLogs from '../features/device-logs';

import {
	apiKeyMiddleware,
	authorizedMiddleware,
	identifyMiddleware,
	permissionRequiredMiddleware,
} from '../infra/auth';

export const setup = (app: Application, onLogin: SetupOptions['onLogin']) => {
	app.get('/config/vars', config.vars);

	auth.setup(app, onLogin);

	app.post('/device/register', apiKeyMiddleware, devices.register);
	app.get(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		registerDeviceStateEvent('params.uuid'),
		devices.state,
	);
	app.patch(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		devices.statePatch,
	);
	deviceLogs.setup(app);
	app.post(
		'/dependent/v1/scan',
		apiKeyMiddleware,
		devices.receiveOnlineDependentDevices,
	);
	app.post(/^\/supervisor(\/.+)$/, apiKeyMiddleware, devices.proxy);

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

	// FIXME(refactor): this is legacy; move it out of here
	// this is deprecated and should be phased out - it's a user api key as well - the appId is irrelevant
	app.post(
		'/application/:appId/generate-api-key',
		authorizedMiddleware,
		apiKeys.createUserApiKey,
	);
	app.post(
		'/api-key/user/full',
		authorizedMiddleware,
		permissionRequiredMiddleware('auth.create_token'),
		apiKeys.createNamedUserApiKey,
	);
	app.post(
		'/api-key/application/:appId/provisioning',
		authorizedMiddleware,
		apiKeys.createProvisioningApiKey,
	);
	app.post(
		'/api-key/device/:deviceId/device-key',
		apiKeyMiddleware,
		apiKeys.createDeviceApiKey,
	);

	app.post('/api-key/v1', authorizedMiddleware, apiKeys.createGenericApiKey);

	app.get(
		'/services/vpn/auth/:device_uuid',
		apiKeyMiddleware,
		services.vpn.authDevice,
	);
	app.post(
		'/services/vpn/client-connect',
		apiKeyMiddleware,
		permissionRequiredMiddleware('service.vpn'),
		services.vpn.clientConnect,
	);
	app.post(
		'/services/vpn/client-disconnect',
		apiKeyMiddleware,
		permissionRequiredMiddleware('service.vpn'),
		services.vpn.clientDisconnect,
	);

	app.get('/auth/v1/token', registry.basicApiKeyAuthenticate, registry.token);

	app.get(
		'/access/v1/hostos/:device_uuid',
		authorizedMiddleware,
		access.hostOSAccess,
	);

	app.get('/device-types/v1', identifyMiddleware, deviceTypes.getDeviceTypes);
	app.get(
		'/device-types/v1/:deviceType',
		identifyMiddleware,
		deviceTypes.getDeviceType,
	);
	app.get(
		'/device-types/v1/:deviceType/images',
		identifyMiddleware,
		deviceTypes.listAvailableImageVersions,
	);
	app.get(
		'/device-types/v1/:deviceType/images/:version/download-size',
		identifyMiddleware,
		deviceTypes.downloadImageSize,
	);

	app.get('/os/v1/config/', os.getOsConfiguration);
};
