import type { Application } from 'express';
import {
	apiKeyMiddleware,
	permissionRequiredMiddleware,
} from '../../infra/auth';
import {
	authDevice,
	clientConnect,
	clientDisconnect,
	denyDeletedDevices,
} from './services';

export const setup = (app: Application) => {
	app.get(
		'/services/vpn/auth/:uuid',
		denyDeletedDevices,
		apiKeyMiddleware,
		authDevice,
	);
	app.post(
		'/services/vpn/client-connect',
		apiKeyMiddleware,
		permissionRequiredMiddleware('service.vpn'),
		clientConnect,
	);
	app.post(
		'/services/vpn/client-disconnect',
		apiKeyMiddleware,
		permissionRequiredMiddleware('service.vpn'),
		clientDisconnect,
	);
};
