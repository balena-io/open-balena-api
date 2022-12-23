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
		middleware.apiKey,
		authDevice,
	);
	app.post(
		'/services/vpn/client-connect',
		middleware.apiKey,
		middleware.permissionRequired('service.vpn'),
		clientConnect,
	);
	app.post(
		'/services/vpn/client-disconnect',
		middleware.apiKey,
		middleware.permissionRequired('service.vpn'),
		clientDisconnect,
	);
};
