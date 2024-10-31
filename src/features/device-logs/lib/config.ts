import type { DeviceLogsBackend, LogContext } from './struct.js';

import _ from 'lodash';
import { RedisBackend } from './backends/redis.js';
import {
	LOGS_DEFAULT_RETENTION_LIMIT,
	LOKI_QUERY_HOST,
	LOKI_READ_PCT,
	LOKI_INGESTER_HOST,
	LOKI_WRITE_PCT,
} from '../../../lib/config.js';

export const LOKI_ENABLED =
	LOKI_QUERY_HOST && LOKI_INGESTER_HOST && LOKI_WRITE_PCT > 0;
export const shouldPublishToLoki = () =>
	LOKI_ENABLED && LOKI_WRITE_PCT > Math.random() * 100;
export const shouldReadFromLoki = () =>
	LOKI_ENABLED && LOKI_READ_PCT > Math.random() * 100;

export function addRetentionLimit(
	ctx: Omit<LogContext, 'retention_limit'>,
): LogContext {
	return {
		...ctx,
		retention_limit: LOGS_DEFAULT_RETENTION_LIMIT,
	};
}

export const getBackend = _.once((): DeviceLogsBackend => new RedisBackend());

export const getLokiBackend = _.once(async (): Promise<DeviceLogsBackend> => {
	const { LokiBackend } = await import('./backends/loki.js');
	return new LokiBackend();
});

export const omitNanoTimestamp = (key: string, value: any) =>
	key === 'nanoTimestamp' ? undefined : value;
