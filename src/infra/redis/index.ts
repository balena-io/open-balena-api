import * as _ from 'lodash';
import * as Redis from 'ioredis';
import {
	MINUTES,
	REDIS_HOST,
	REDIS_PORT,
	REDIS_RO_HOST,
	REDIS_RO_PORT,
} from '../../lib/config';
import { captureException } from '../error-handling';

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy: NonNullable<
	ConstructorParameters<typeof Redis>[0]
>['retryStrategy'] = _.constant(200);

export const createIsolatedRedis = ({ readOnly = false } = {}) => {
	return new Redis({
		host: readOnly ? REDIS_RO_HOST : REDIS_HOST,
		port: readOnly ? REDIS_RO_PORT : REDIS_PORT,
		retryStrategy: redisRetryStrategy,
		enableOfflineQueue: false,
		enableAutoPipelining: true,
	}).on(
		// If not handled will crash the process
		'error',
		_.throttle((err: Error) => {
			captureException(err, 'Redis error');
		}, 5 * MINUTES),
	);
};

export const redis = createIsolatedRedis();

export const redisRO = createIsolatedRedis({ readOnly: true });

export const newSubscribeInstance = () => {
	return createIsolatedRedis({ readOnly: true });
};
