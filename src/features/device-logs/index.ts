import type { Application } from 'express';

import {
	createRateLimiter,
	createRateLimitMiddleware,
} from '../../infra/rate-limiting';
import { middleware } from '../../infra/auth';
import { read } from './lib/read';
import { store, storeStream } from './lib/store';
import { SetupOptions } from '../..';
import { resolveOrDenyDevicesWithStatus } from '../device-state/middleware';

// Rate limit for device log creation, a maximum of 15 batches every 10 second window
const deviceLogsRateLimiter = createRateLimitMiddleware(
	createRateLimiter('device-logs', {
		points: 14, // allow 15 device log batches (1+14 "retries") per window
		blockDuration: 10, // seconds
		duration: 10, // reset counter after 10 seconds (from the first batch of the window)
	}),
	{
		ignoreIP: true,
	},
);

// Rate limit device log get requests
const streamableDeviceLogsRateLimiter = createRateLimitMiddleware(
	createRateLimiter('get-device-logs', {
		points: 10, // allow 10 device log streams / get requests
		blockDuration: 60, // seconds
		duration: 60, // reset counter after 60 seconds (from the first batch of the window)
	}),
	{
		ignoreIP: true,
	},
);

export const setup = (
	app: Application,
	onLogWriteStreamInitialized: SetupOptions['onLogWriteStreamInitialized'],
	onLogReadStreamInitialized: SetupOptions['onLogReadStreamInitialized'],
) => {
	app.get(
		'/device/v2/:uuid/logs',
		middleware.fullyAuthenticatedUser,
		streamableDeviceLogsRateLimiter(['params.uuid', 'query.stream']),
		read(onLogReadStreamInitialized),
	);
	app.post(
		'/device/v2/:uuid/logs',
		resolveOrDenyDevicesWithStatus(401),
		deviceLogsRateLimiter('params.uuid'),
		middleware.authenticatedApiKey,
		store,
	);
	app.post(
		'/device/v2/:uuid/log-stream',
		resolveOrDenyDevicesWithStatus(401),
		middleware.authenticatedApiKey,
		storeStream(onLogWriteStreamInitialized),
	);
};
