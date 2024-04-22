import _ from 'lodash';
import { Redis } from 'ioredis';
import * as NodeRedis from 'redis';
import type { REDIS } from '../../lib/config.js';
import { MINUTES } from '@balena/env-parsing';
import { captureException } from '../error-handling/index.js';
import { getNodeRedisOptions, getRedisOptions } from './config.js';

export const createIsolatedNodeRedis = async (
	...args: Parameters<typeof getNodeRedisOptions>
) => {
	const redisOpts = getNodeRedisOptions(...args);

	let redisClient;
	if ('rootNodes' in redisOpts) {
		redisClient = NodeRedis.createCluster(
			// We ignore the read-only separation in cluster mode as it'll automatically redirect
			// reads to the replicas so there's no need for manual splitting
			redisOpts,
		);
	} else {
		redisClient = NodeRedis.createClient(redisOpts);
	}
	redisClient.on(
		// If not handled will crash the process
		'error',
		_.throttle((err: Error) => {
			captureException(err, 'Redis error');
		}, 5 * MINUTES),
	);
	await redisClient.connect();
	return redisClient;
};

export const createIsolatedRedis = (
	...args: Parameters<typeof getRedisOptions>
) => {
	const redisOpts = getRedisOptions(...args);

	let redisClient;
	if ('nodes' in redisOpts) {
		redisClient = new Redis.Cluster(
			// We ignore the read-only separation in cluster mode as it'll automatically redirect
			// reads to the replicas so there's no need for manual splitting
			redisOpts.nodes,
			redisOpts.options,
		);
	} else {
		redisClient = new Redis(redisOpts);
	}
	return redisClient.on(
		// If not handled will crash the process
		'error',
		_.throttle((err: Error) => {
			captureException(err, 'Redis error');
		}, 5 * MINUTES),
	);
};

export const redis = createIsolatedRedis();
export const redisRO = createIsolatedRedis({ readOnly: true });

export const nodeRedis = await createIsolatedNodeRedis();
export const nodeRedisRO = await createIsolatedNodeRedis({ readOnly: true });

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

export const newNodeRedisSubscribeInstance = async ({
	instance = 'general',
}: {
	instance?: keyof typeof REDIS;
} = {}) => {
	return await createIsolatedNodeRedis({
		instance,
		readOnly: true,
	});
};
