import type { Application } from 'express';

import {
	createRateLimiter,
	createRateLimitMiddleware,
} from '../../infra/rate-limiting';
import { apiKeyMiddleware, authorizedMiddleware } from '../../infra/auth';
import { read } from './lib/read';
import { store, storeStream } from './lib/store';
import { SetupOptions } from '../..';

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
		authorizedMiddleware,
		read(onLogReadStreamInitialized),
	);
	app.post(
		'/device/v2/:uuid/logs',
		deviceLogsRateLimiter('params.uuid'),
		apiKeyMiddleware,
		store,
	);
	app.post(
		'/device/v2/:uuid/log-stream',
		apiKeyMiddleware,
		storeStream(onLogWriteStreamInitialized),
	);
};
