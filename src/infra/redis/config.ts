import _ from 'lodash';
import type * as Redis from 'ioredis';
import type * as NodeRedis from 'redis';
import { REDIS } from '../../lib/config.js';
import type { HostPort } from '@balena/env-parsing';

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy = _.constant(200);

const keepAlive = 0;
const connectTimeout = 10000;

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
		keepAlive,
		connectTimeout,
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

const hostPortToUrl = (h: HostPort) => `redis://${h.host}:${h.port}`;
export const getNodeRedisOptions = ({
	readOnly = false,
	instance = 'general',
}: {
	readOnly?: boolean;
	instance?: keyof typeof REDIS;
} = {}): NodeRedis.RedisClusterOptions | NodeRedis.RedisClientOptions => {
	const r = REDIS[instance];

	const redisOptions: NodeRedis.RedisClientOptions = {
		socket: {
			connectTimeout,
			keepAlive,
			reconnectStrategy: redisRetryStrategy,
		},
		disableOfflineQueue: true,
	};

	if (r.isCluster) {
		return {
			// We ignore the read-only separation in cluster mode as it'll automatically redirect
			// reads to the replicas so there's no need for manual splitting
			rootNodes: r.hosts.map((h) => {
				return { url: hostPortToUrl(h) };
			}),
			useReplicas: true,
			defaults: {
				...r.auth,
				...redisOptions,
			},
		};
	} else {
		return {
			url: hostPortToUrl(readOnly ? r.roHost : r.host),
			...(readOnly ? r.roAuth : r.auth),
			...redisOptions,
		};
	}
};
