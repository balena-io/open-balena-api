import type { Application } from 'express';

import { createRateLimitMiddleware } from '../lib/rate-limiting';
import { apiKeyMiddleware, authorized } from '../platform/middleware';
import * as deviceLogs from './device-logs';

// Rate limit for device log creation, a maximum of 15 batches every 10 second window
const deviceLogsRateLimiter = createRateLimitMiddleware(
	{
		points: 14, // allow 15 device log batches (1+14 "retries") per window
		blockDuration: 10, // seconds
		duration: 10, // reset counter after 10 seconds (from the first batch of the window)
	},
	{
		ignoreIP: true,
	},
);

export const setup = (app: Application) => {
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
};
