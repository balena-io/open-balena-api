import type { Application } from 'express';

import {
	createRateLimiter,
	createRateLimitMiddleware,
} from '../../infra/rate-limiting/index.ts';
import { middleware } from '../../infra/auth/index.ts';
import { read } from './lib/read.ts';
import { store, storeStream } from './lib/store.ts';
import type { SetupOptions } from '../../index.ts';
import { resolveOrDenyDevicesWithStatus } from '../device-state/middleware.ts';
import { DELETED_FROZEN_DEVICE_LOGS_DELAY_MS } from '../../lib/config.ts';

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

export const setup = (
	app: Application,
	onLogWriteStreamInitialized: SetupOptions['onLogWriteStreamInitialized'],
	onLogReadStreamInitialized: SetupOptions['onLogReadStreamInitialized'],
) => {
	app.get(
		'/device/v2/:uuid/logs',
		middleware.fullyAuthenticatedUser,
		read(onLogReadStreamInitialized),
	);
	app.post(
		'/device/v2/:uuid/logs',
		resolveOrDenyDevicesWithStatus(
			401,
			undefined,
			DELETED_FROZEN_DEVICE_LOGS_DELAY_MS,
		),
		deviceLogsRateLimiter('params.uuid'),
		middleware.authenticatedApiKey,
		store,
	);
	app.post(
		'/device/v2/:uuid/log-stream',
		resolveOrDenyDevicesWithStatus(
			401,
			undefined,
			DELETED_FROZEN_DEVICE_LOGS_DELAY_MS,
		),
		middleware.authenticatedApiKey,
		storeStream(onLogWriteStreamInitialized),
	);
};
