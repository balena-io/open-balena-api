import type { DeviceLogsBackend, LogContext } from './struct.js';

import _ from 'lodash';
import {
	LOGS_DEFAULT_RETENTION_LIMIT,
	LOKI_READ_PCT,
	LOKI_WRITE_PCT,
	LOGS_LOKI_ENABLED,
	LOGS_REDIS_ENABLED,
	LOGS_PRIMARY_BACKEND,
	LOGS_REDIS_READ_PCT,
	LOGS_REDIS_WRITE_PCT,
} from '../../../lib/config.js';

const LOGS_SECONDARY_BACKEND =
	LOGS_PRIMARY_BACKEND === 'loki' ? 'redis' : 'loki';

export const LOGS_SECONDARY_BACKEND_ENABLED =
	(LOGS_SECONDARY_BACKEND === 'loki' && LOGS_LOKI_ENABLED) ||
	(LOGS_SECONDARY_BACKEND === 'redis' && LOGS_REDIS_ENABLED);

export const shouldReadFromSecondary = (): boolean => {
	if (LOGS_SECONDARY_BACKEND_ENABLED) {
		if (LOGS_SECONDARY_BACKEND === 'loki') {
			return LOKI_READ_PCT > Math.random() * 100;
		} else if (LOGS_SECONDARY_BACKEND === 'redis') {
			return LOGS_REDIS_READ_PCT > Math.random() * 100;
		}
	}
	return false;
};
export const shouldPublishToSecondary = (): boolean => {
	if (LOGS_SECONDARY_BACKEND_ENABLED) {
		if (LOGS_SECONDARY_BACKEND === 'loki') {
			return LOKI_WRITE_PCT > Math.random() * 100;
		} else if (LOGS_SECONDARY_BACKEND === 'redis') {
			return LOGS_REDIS_WRITE_PCT > Math.random() * 100;
		}
	}
	return false;
};

export function addRetentionLimit(
	ctx: Omit<LogContext, 'retention_limit'>,
): LogContext {
	return {
		...ctx,
		retention_limit: LOGS_DEFAULT_RETENTION_LIMIT,
	};
}

export const getPrimaryBackend = _.once(
	async (): Promise<DeviceLogsBackend> =>
		LOGS_PRIMARY_BACKEND === 'redis'
			? await getRedisBackend()
			: await getLokiBackend(),
);

export const getSecondaryBackend = _.once(
	async (): Promise<DeviceLogsBackend> => {
		if (LOGS_SECONDARY_BACKEND_ENABLED === false) {
			throw new Error('Secondary backend is not enabled');
		}
		return LOGS_SECONDARY_BACKEND === 'redis'
			? await getRedisBackend()
			: await getLokiBackend();
	},
);

const getRedisBackend = _.once(async (): Promise<DeviceLogsBackend> => {
	const { RedisBackend } = await import('./backends/redis.js');
	return new RedisBackend();
});

const getLokiBackend = _.once(async (): Promise<DeviceLogsBackend> => {
	const { LokiBackend } = await import('./backends/loki.js');
	return new LokiBackend();
});

export const omitNanoTimestamp = (key: string, value: any) =>
	key === 'nanoTimestamp' ? undefined : value;
