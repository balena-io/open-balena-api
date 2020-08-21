import type { DeviceLogsBackend, LogContext } from './struct';

import { RedisBackend } from './backends/redis';

export const NDJSON_CTYPE = 'application/x-ndjson';

// Read config
export const HEARTBEAT_INTERVAL = 58e3;
export const DEFAULT_HISTORY_LOGS = 1000;
export const DEFAULT_SUBSCRIPTION_LOGS = 0;

// Write config
export const STREAM_FLUSH_INTERVAL = 500;
export const BACKEND_UNAVAILABLE_FLUSH_INTERVAL = 5000;
export const WRITE_BUFFER_LIMIT = 50;

const DEFAULT_RETENTION_LIMIT = 1000;

const redis = new RedisBackend();

export function addRetentionLimit(ctx: LogContext) {
	ctx.retention_limit = DEFAULT_RETENTION_LIMIT;
}

export function getBackend(_ctx: LogContext): DeviceLogsBackend {
	return redis;
}
