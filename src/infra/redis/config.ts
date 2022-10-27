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
} = {}):
	| {
			nodes: Redis.ClusterNode[];
			options: Redis.ClusterOptions;
	  }
	| Redis.RedisOptions => {
	const r = REDIS[instance];

	const redisOptions: Redis.RedisOptions = {
		retryStrategy: redisRetryStrategy,
		enableOfflineQueue: false,
		enableAutoPipelining,
		// @ts-expect-error - `keepAlive` is actually used as `initialDelay` which is a number as the typings say
		//                    but it clashes with the socket keepAlive option which is a boolean, this probably
		//                    needs updated ioredis typings
		keepAlive: 0,
	};

	if (r.isCluster) {
		return {
			// We ignore the read-only separation in cluster mode as it'll automatically redirect
			// reads to the replicas so there's no need for manual splitting
			nodes: r.hosts,
			options: {
				clusterRetryStrategy: redisRetryStrategy,
				enableOfflineQueue: false,
				scaleReads: 'slave',
				redisOptions,
			},
		};
	} else {
		return {
			...(readOnly ? r.roHost : r.host),
			...redisOptions,
		};
	}
};
