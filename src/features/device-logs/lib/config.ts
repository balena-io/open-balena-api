import type { DeviceLogsBackend, LogContext } from './struct';

import * as _ from 'lodash';
import { RedisBackend } from './backends/redis';
import {
	LOGS_DEFAULT_RETENTION_LIMIT,
	LOKI_HOST,
	LOKI_WRITE_PCT,
} from '../../../lib/config';

export const shouldPublishToLoki = () =>
	LOKI_HOST && LOKI_WRITE_PCT > Math.random() * 100;

export function addRetentionLimit<T extends LogContext>(
	ctx: Omit<T, 'retention_limit'>,
): T {
	return {
		...ctx,
		retention_limit: LOGS_DEFAULT_RETENTION_LIMIT,
	} as T;
}

export const getBackend = _.once((): DeviceLogsBackend => new RedisBackend());

export const getLokiBackend = _.once((): DeviceLogsBackend => {
	const { LokiBackend } =
		require('./backends/loki') as typeof import('./backends/loki');
	return new LokiBackend();
});
