import * as _ from 'lodash';
import * as cacheManager from 'cache-manager';
import redisStore = require('cache-manager-redis-store');
import { REDIS_HOST, REDIS_PORT, version } from '../../lib/config';
import { Defined } from '.';

const usedCacheKeys: Dictionary<true> = {};

export type MultiStoreOpt = Pick<cacheManager.StoreConfig, 'ttl' | 'max'> & {
	refreshThreshold?: number;
} & cacheManager.CacheOptions;

export function createMultiLevelStore<T extends Defined>(
	cacheKey: string,
	opts: MultiStoreOpt[],
): {
	get: (key: string) => Promise<T | undefined>;
	set: (key: string, value: T) => Promise<void>;
	delete: (key: string) => Promise<void>;
	wrap: (key: string, fn: () => T) => Promise<T>;
} {
	if (usedCacheKeys[cacheKey] === true) {
		throw new Error(`Cache key '${cacheKey}' has already been taken`);
	}
	if (opts.length === 0) {
		throw new Error(`No multiCache options provided for '${cacheKey}'`);
	}
	usedCacheKeys[cacheKey] = true;

	const [baseOpts, redisOpts] = opts;
	const { isCacheableValue } = baseOpts;
	const memoryCache = cacheManager.caching({ ...baseOpts, store: 'memory' });
	const redisCache = cacheManager.caching({
		...baseOpts,
		...redisOpts,
		store: redisStore,
		host: REDIS_HOST,
		port: REDIS_PORT,
		// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
		isCacheableValue: (v) => v != null && isCacheableValue?.(v) === true,
	});
	const cache = cacheManager.multiCaching([memoryCache, redisCache]);

	let keyPrefix: string;
	const getKey = (key: string) => {
		// We include the version so that we get automatic invalidation on updates which might change the memoized fn behavior,
		// we also calculate the keyPrefix lazily so that the version has a chance to be set as otherwise the memoized function
		// creation can happen before the version has been initialized
		keyPrefix ??= `cache$${version}$${cacheKey}$`;
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
