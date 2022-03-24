import * as _ from 'lodash';
import * as Redis from 'ioredis';
import { REDIS } from '../../lib/config';

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy = _.constant(200);

export const getRedisOptions = ({
	readOnly = false,
	instance = 'general',
	enableAutoPipelining = true,
}: {
	readOnly?: boolean;
	instance?: keyof typeof REDIS;
	enableAutoPipelining?: boolean;
} = {}): Redis.RedisOptions => {
	const r = REDIS[instance];

	return {
		host: readOnly ? r.roHost : r.host,
		port: readOnly ? r.roPort : r.port,
		retryStrategy: redisRetryStrategy,
		enableOfflineQueue: false,
		enableAutoPipelining,
		keepAlive: 0,
	};
};
