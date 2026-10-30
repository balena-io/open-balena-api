import _ from 'lodash';
import * as NodeRedis from 'redis';
import type { REDIS } from '../../lib/config.ts';
import { MINUTES } from '@balena/env-parsing';
import { captureException } from '../error-handling/index.ts';
import { getRedisOptions } from './config.ts';

export const createIsolatedRedis = async <
	S extends NodeRedis.RedisScripts = Record<never, never>,
>({
	scripts,
	...opts
}: NonNullable<Parameters<typeof getRedisOptions>[0]> & {
	scripts?: S;
} = {}) => {
	const redisOpts = getRedisOptions(opts);

	let redisClient;
	if ('rootNodes' in redisOpts) {
		redisClient = NodeRedis.createCluster({
			// We ignore the read-only separation in cluster mode as it'll automatically redirect
			// reads to the replicas so there's no need for manual splitting
			...redisOpts,
			scripts,
		});
	} else {
		redisClient = NodeRedis.createClient({ ...redisOpts, scripts });
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

export const redis = await createIsolatedRedis();
export const redisRO = await createIsolatedRedis({ readOnly: true });

export const newSubscribeInstance = async ({
	instance = 'general',
}: {
	instance?: keyof typeof REDIS;
} = {}) => {
	return await createIsolatedRedis({
		instance,
		readOnly: true,
	});
};
