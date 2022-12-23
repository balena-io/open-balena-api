import type { Application } from 'express';
import { middleware } from '../../infra/auth';
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
		middleware.resolveApiKey,
		authDevice,
	);
	app.post(
		'/services/vpn/client-connect',
		middleware.resolveApiKey,
		middleware.permissionRequired('service.vpn'),
		clientConnect,
	);
	app.post(
		'/services/vpn/client-disconnect',
		middleware.resolveApiKey,
		middleware.permissionRequired('service.vpn'),
		clientDisconnect,
	);
};
