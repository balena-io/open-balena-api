import _ from 'lodash';
import type * as NodeRedis from 'redis';
import { REDIS } from '../../lib/config.ts';
import type { HostPort } from '@balena/env-parsing';

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy = _.constant(200);

const keepAlive = 0;
const connectTimeout = 10000;

const hostPortToUrl = (h: HostPort) => `redis://${h.host}:${h.port}`;
export const getRedisOptions = ({
	readOnly = false,
	instance = 'general',
}: {
	readOnly?: boolean;
	instance?: keyof typeof REDIS;
} = {}): NodeRedis.RedisClusterOptions | NodeRedis.RedisClientOptions => {
	const r = REDIS[instance];

	const commandOptions: NodeRedis.RedisClientOptions['commandOptions'] = {
		// Keep the v4 behaviour of having no command timeout rather than the v6 default of 5s,
		// commands already fail fast when disconnected due to `disableOfflineQueue`. This also avoids the
		// overhead of tracking the timeout
		timeout: undefined,
	};
	const redisOptions: NodeRedis.RedisClientOptions = {
		socket: {
			connectTimeout,
			keepAlive: true,
			keepAliveInitialDelay: keepAlive,
			reconnectStrategy: redisRetryStrategy,
		},
		disableOfflineQueue: true,
		// Only supported by Redis Enterprise, Valkey does not implement `CLIENT MAINT_NOTIFICATIONS`
		maintNotifications: 'disabled',
	};

	if (r.isCluster) {
		return {
			// We ignore the read-only separation in cluster mode as it'll automatically redirect
			// reads to the replicas so there's no need for manual splitting
			rootNodes: r.hosts.map((h) => {
				return { url: hostPortToUrl(h) };
			}),
			useReplicas: true,
			commandOptions,
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
			commandOptions,
		};
	}
};
