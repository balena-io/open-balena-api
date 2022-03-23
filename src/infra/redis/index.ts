import * as _ from 'lodash';
import * as Redis from 'ioredis';
import { MINUTES, REDIS } from '../../lib/config';
import { captureException } from '../error-handling';
import { getRedisOptions } from './config';

export const createIsolatedRedis = (
	...args: Parameters<typeof getRedisOptions>
) => {
	const redisOpts = getRedisOptions(...args);
	return new Redis(redisOpts).on(
		// If not handled will crash the process
		'error',
		_.throttle((err: Error) => {
			captureException(err, 'Redis error');
		}, 5 * MINUTES),
	);
};

export const redis = createIsolatedRedis();

export const redisRO = createIsolatedRedis({ readOnly: true });

export const newSubscribeInstance = ({
	instance = 'general',
}: {
	instance?: keyof typeof REDIS;
} = {}) => {
	return createIsolatedRedis({
		instance,
		readOnly: true,
		enableAutoPipelining: false,
	});
};
