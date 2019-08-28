import { Application } from 'express';

import {
	authorized,
	apiKeyMiddleware,
	permissionRequired,
	gracefullyDenyDeletedDevices,
} from '../platform/middleware';

import {
	SECONDS,
	HOURS,
	SECONDS_PER_HOUR,
	createRateLimitMiddleware,
} from '../lib/rate-limiting';

// Rate limit for unauthenticated access
export const loginRateLimiter = createRateLimitMiddleware({
	freeRetries: 10, // 10 tries
	minWait: 1 * HOURS, // wait 1 hour after 10 tries (in ms)
	maxWait: 1 * HOURS, // wait 1 hour after 10 tries (in ms)
	lifetime: 2 * SECONDS_PER_HOUR, // reset counter after 2 hours (in seconds)
});

// Rate limit for device log creation, a maximum of 15 batches every 10 second window
export const deviceLogsRateLimiter = createRateLimitMiddleware(
	{
		freeRetries: 14, // allow 15 device log batches (1+14 "retries") per window
		minWait: 10 * SECONDS,
		maxWait: 10 * SECONDS,
		lifetime: 10, // reset counter after 10 seconds (from the first batch of the window)
		refreshTimeoutOnRequest: false,
	},
	{
		ignoreIP: true,
	},
);

import * as access from '../routes/access';
import * as apiKeys from '../routes/api-keys';
import * as applications from '../routes/applications';
import * as auth from '../routes/auth';
import * as config from '../routes/config';
import * as deviceTypes from '../routes/device-types';
import * as deviceLogs from '../routes/device-logs';
import * as devices from '../routes/devices';
import * as os from '../routes/os';
import * as services from '../routes/services';
import * as session from '../routes/session';
import * as registry from '../routes/registry';
import { SetupOptions } from '..';

export const setup = (app: Application, onLogin: SetupOptions['onLogin']) => {
	app.get('/config/vars', config.vars);

	app.post(
		'/login_',
		loginRateLimiter('body.username'),
		session.login(onLogin),
	);
	app.get('/user/v1/whoami', authorized, session.whoami);

	app.post('/device/register', apiKeyMiddleware, devices.register);
	app.get(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		devices.state,
	);
	app.patch(
		'/device/v2/:uuid/state',
		gracefullyDenyDeletedDevices,
		apiKeyMiddleware,
		devices.statePatch,
	);
	app.get('/device/v2/:uuid/logs', authorized, deviceLogs.read);
	app.post(
		'/device/v2/:uuid/logs',
		deviceLogsRateLimiter('params.uuid'),
		apiKeyMiddleware,
		deviceLogs.store,
	);
	app.post(
		'/device/v2/:uuid/log-stream',
		apiKeyMiddleware,
		deviceLogs.storeStream,
	);
	app.post(
		'/dependent/v1/scan',
		apiKeyMiddleware,
		devices.receiveOnlineDependentDevices,
	);
	app.post(/^\/supervisor(\/.+)$/, apiKeyMiddleware, devices.proxy);

	app.get('/download-config', authorized, applications.downloadImageConfig);
	app.post('/download-config', authorized, applications.downloadImageConfig);

	// FIXME(refactor): this is legacy; move it out of here
	// this is deprecated and should be phased out - it's a user api key as well - the appId is irrelevant
	app.post(
		'/application/:appId/generate-api-key',
		authorized,
		apiKeys.createUserApiKey,
	);
	app.post(
		'/api-key/user/full',
		authorized,
		permissionRequired('auth.create_token'),
		apiKeys.createNamedUserApiKey,
	);
	app.post(
		'/api-key/application/:appId/provisioning',
		authorized,
		apiKeys.createProvisioningApiKey,
	);
	app.post(
		'/api-key/device/:deviceId/device-key',
		apiKeyMiddleware,
		apiKeys.createDeviceApiKey,
	);

	app.get(
		'/services/vpn/auth/:device_uuid',
		apiKeyMiddleware,
		services.vpn.authDevice,
	);
	app.post(
		'/services/vpn/client-connect',
		apiKeyMiddleware,
		permissionRequired('service.vpn'),
		services.vpn.clientConnect,
	);
	app.post(
		'/services/vpn/client-disconnect',
		apiKeyMiddleware,
		permissionRequired('service.vpn'),
		services.vpn.clientDisconnect,
	);

	app.get('/auth/v1/token', registry.basicApiKeyAuthenticate, registry.token);

	app.get(
		'/auth/v1/public-keys/:username',
		apiKeyMiddleware,
		auth.getUserPublicKeys,
	);

	app.get('/access/v1/hostos/:device_uuid', authorized, access.hostOSAccess);

	app.get('/device-types/v1', deviceTypes.getDeviceTypes);
	app.get('/device-types/v1/:deviceType', deviceTypes.getDeviceType);
	app.get(
		'/device-types/v1/:deviceType/images',
		deviceTypes.listAvailableImageVersions,
	);
	app.get(
		'/device-types/v1/:deviceType/images/:version/download-size',
		deviceTypes.downloadImageSize,
	);

	app.get('/os/v1/config/', os.getOsConfiguration);
};
