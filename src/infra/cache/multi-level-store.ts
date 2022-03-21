import * as _ from 'lodash';
import * as cacheManager from 'cache-manager';
import redisStore = require('cache-manager-ioredis');
import { version } from '../../lib/config';
import { Defined } from '.';
import { redis } from '../redis';

const usedCacheKeys: Dictionary<true> = {};

export type MultiStoreOpt = Pick<cacheManager.StoreConfig, 'ttl' | 'max'> & {
	refreshThreshold?: number;
};

/**
 * @param useVersion
 * Do not use the api version as part of the cache key, this disables automatic invalidation on
 * version updates and so anything that may change the result needs to be manually invalidated,
 * eg by changing the cacheKey
 */
export function createMultiLevelStore<T extends Defined>(
	cacheKey: string,
	opts:
		| (MultiStoreOpt & cacheManager.CacheOptions)
		| {
				default: MultiStoreOpt & cacheManager.CacheOptions;
				local?: MultiStoreOpt | false;
				global?: MultiStoreOpt;
		  },
	useVersion = true,
): {
	get: (key: string) => Promise<T | undefined>;
	set: (key: string, value: T) => Promise<void>;
	delete: (key: string) => Promise<void>;
	wrap: (key: string, fn: () => T) => Promise<T>;
} {
	if (usedCacheKeys[cacheKey] === true) {
		throw new Error(`Cache key '${cacheKey}' has already been taken`);
	}
	usedCacheKeys[cacheKey] = true;

	if (!('default' in opts)) {
		opts = { default: opts };
	}
	const { default: baseOpts, local, global } = opts;
	const { isCacheableValue } = baseOpts;
	const memoryCache =
		local === false
			? undefined
			: cacheManager.caching({ ...baseOpts, ...local, store: 'memory' });
	const redisCache = cacheManager.caching({
		...baseOpts,
		...global,
		store: redisStore,
		redisInstance: redis,
		// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
		isCacheableValue: (v) =>
			v != null && (isCacheableValue == null || isCacheableValue(v) === true),
	});
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
