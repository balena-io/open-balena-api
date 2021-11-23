import * as _ from 'lodash';
import * as Redis from 'ioredis';
import { MINUTES, REDIS } from '../../lib/config';
import { captureException } from '../error-handling';

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy: NonNullable<
	ConstructorParameters<typeof Redis>[0]
>['retryStrategy'] = _.constant(200);

export const createIsolatedRedis = ({
	readOnly = false,
	instance = 'general',
	enableAutoPipelining = true,
}: {
	readOnly?: boolean;
	instance?: keyof typeof REDIS;
	enableAutoPipelining?: boolean;
} = {}) => {
	const r = REDIS[instance];
	return new Redis({
		host: readOnly ? r.roHost : r.host,
		port: readOnly ? r.roPort : r.port,
		retryStrategy: redisRetryStrategy,
		enableOfflineQueue: false,
		enableAutoPipelining,
		keepAlive: 0,
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
