import type { DeviceLogsBackend, LogContext } from './struct';

import * as _ from 'lodash';
import { RedisBackend } from './backends/redis';
import { LOKI_HOST, LOKI_WRITE_PCT } from '../../../lib/config';

export const NDJSON_CTYPE = 'application/x-ndjson';

// Read config
export const HEARTBEAT_INTERVAL = 58000;
export const DEFAULT_HISTORY_LOGS = 1000;
export const DEFAULT_SUBSCRIPTION_LOGS = 0;
export const SUBSCRIPTION_EXPIRY_SECONDS = 60 * 60;
export const SUBSCRIPTION_EXPIRY_HEARTBEAT_SECONDS =
	SUBSCRIPTION_EXPIRY_SECONDS / 2;

const DEFAULT_RETENTION_LIMIT = 1000;

export const shouldPublishToLoki = () =>
	LOKI_HOST && LOKI_WRITE_PCT > Math.random() * 100;

export function addRetentionLimit<T extends LogContext>(
	ctx: Omit<T, 'retention_limit'>,
): T {
	return {
		...ctx,
		retention_limit: DEFAULT_RETENTION_LIMIT,
	} as T;
}

export const getBackend = _.once((): DeviceLogsBackend => new RedisBackend());

export const getLokiBackend = _.once((): DeviceLogsBackend => {
	const { LokiBackend } =
		require('./backends/loki') as typeof import('./backends/loki');
	return new LokiBackend();
});
