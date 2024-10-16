import cacheManager from 'cache-manager';
import redisStore from 'cache-manager-ioredis';
import { version } from '../../lib/config.js';
import type { Defined } from './index.js';
import { getRedisOptions } from '../redis/config.js';

const usedCacheKeys: Dictionary<true> = {};

export type MultiStoreOpt = Pick<cacheManager.StoreConfig, 'ttl' | 'max'> & {
	refreshThreshold?: number;
};

export function createMultiLevelStore<T extends Defined>(
	cacheKey: string,
	opts: {
		default: MultiStoreOpt & cacheManager.CacheOptions;
		local?: MultiStoreOpt | false;
		/**
		 * The global store will ignore the `max` anyway, so avoiding passing it in will help reduce confusion
		 */
		global?: Exclude<MultiStoreOpt, 'max'>;
		/**
		 * Do not use the api version as part of the cache key, this disables automatic invalidation on
		 * version updates and so anything that may change the result needs to be manually invalidated,
		 * eg by changing the cacheKey
		 */
		useVersion: boolean;
	},
): {
	get: (key: string) => Promise<T | undefined>;
	set: (key: string, value: T) => Promise<void>;
	delete: (key: string) => Promise<void>;
	wrap: (key: string, fn: () => T | Promise<T>) => Promise<T>;
} {
	if (usedCacheKeys[cacheKey] === true) {
		throw new Error(`Cache key '${cacheKey}' has already been taken`);
	}
	usedCacheKeys[cacheKey] = true;

	const { default: baseOpts, local, global, useVersion } = opts;
	const { isCacheableValue } = baseOpts;
	const memoryCache =
		local === false
			? undefined
			: cacheManager.caching({ ...baseOpts, ...local, store: 'memory' });

	let cacheOpts: cacheManager.StoreConfig & cacheManager.CacheOptions = {
		...baseOpts,
		...global,
		store: redisStore,
		isCacheableValue: (v) =>
			// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
			v != null && (isCacheableValue == null || isCacheableValue(v) === true),
	};
	const redisOpts = getRedisOptions();

	if ('nodes' in redisOpts) {
		// @ts-expect-error: This shouldn't really need to be passed here but due to a quirk of cache-manager-ioredis it expects
		// all the store opts to be stored on the created redis instance
		redisOpts.options.isCacheableValue = cacheOpts.isCacheableValue;
		cacheOpts.clusterConfig = redisOpts;
	} else {
		cacheOpts = { ...cacheOpts, ...redisOpts };
	}

	const redisCache = cacheManager.caching(cacheOpts);
	const cache = memoryCache
		? cacheManager.multiCaching([memoryCache, redisCache])
		: redisCache;

	let keyPrefix: string;
	const getKey = (key: string) => {
		// We include the version so that we get automatic invalidation on updates which might change the memoized fn behavior,
		// we also calculate the keyPrefix lazily so that the version has a chance to be set as otherwise the memoized function
		// creation can happen before the version has been initialized
		keyPrefix ??= `cache$${useVersion ? version : ''}$${cacheKey}$`;
		return `${keyPrefix}${key}`;
	};

	return {
		get: async (key) => {
			const fullKey = getKey(key);
			return await cache.get(fullKey);
		},
		set: async (key, value) => {
			const fullKey = getKey(key);
			await cache.set(fullKey, value);
		},
		delete: async (key) => {
			const fullKey = getKey(key);
			await cache.del(fullKey);
		},
		wrap: async (key, fn) => {
			const fullKey = getKey(key);
			return await cache.wrap(fullKey, fn);
		},
	};
}
