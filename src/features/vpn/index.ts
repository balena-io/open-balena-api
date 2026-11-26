import type { Application } from 'express';
import { permissions, sbvrUtils } from '@balena/pinejs';
import { VPN_SERVICE_INSTANCE_HEARTBEAT_TIMEOUT } from '../../lib/config.ts';
import { middleware } from '../../infra/auth/index.ts';
import { scheduleJob } from '../../infra/scheduler/index.ts';
import {
	authDevice,
	clientConnect,
	clientDisconnect,
	denyDeletedDevices,
} from './services.ts';

export const setup = (app: Application) => {
	app.get(
		'/services/vpn/auth/:uuid',
		denyDeletedDevices,
		middleware.authenticatedApiKey,
		authDevice,
	);
	app.post(
		'/services/vpn/client-connect',
		middleware.authenticatedApiKey,
		middleware.permissionRequired('service.vpn'),
		clientConnect,
	);
	app.post(
		'/services/vpn/client-disconnect',
		middleware.authenticatedApiKey,
		middleware.permissionRequired('service.vpn'),
		clientDisconnect,
	);
};

// A vpn that is killed or crashes never reports its clients as disconnected
export const resetStaleConnections = async () => {
	const cutoff = new Date(Date.now() - VPN_SERVICE_INSTANCE_HEARTBEAT_TIMEOUT);
	await sbvrUtils.api.resin.patch({
		resource: 'device',
		passthrough: { req: permissions.root },
		options: {
			$filter: {
				is_connected_to_vpn: true,
				is_managed_by__service_instance: {
					$any: {
						$alias: 'si',
						$expr: { si: { last_heartbeat: { $lt: cutoff } } },
					},
				},
			},
		},
		body: { is_connected_to_vpn: false, is_managed_by__service_instance: null },
	});
};

export const startStaleConnectionReset = () =>
	scheduleJob('vpnStaleConnectionReset', '* * * * *', async () => {
		// Heartbeats missed while this API was down do not mean that the vpn is gone
		if (process.uptime() * 1000 > VPN_SERVICE_INSTANCE_HEARTBEAT_TIMEOUT) {
			await resetStaleConnections();
		}
	});
