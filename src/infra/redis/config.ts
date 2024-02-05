import _ from 'lodash';
import type * as Redis from 'ioredis';
import { REDIS } from '../../lib/config.js';

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
				...r.auth,
			},
		};
	} else {
		return {
			...(readOnly ? r.roHost : r.host),
			...(readOnly ? r.roAuth : r.auth),
			...redisOptions,
		};
	}
};
