import * as _ from 'lodash';
import * as cacheManager from 'cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { version } from '../../lib/config';
import { Defined } from '.';
import { getRedisOptions } from '../redis/config';

const usedCacheKeys: Dictionary<true> = {};

export interface CacheOptions extends Pick<cacheManager.Config, 'isCacheable'> {
	/** @deprecated User isCacheable instead */
	isCacheableValue?(value: unknown): boolean;
}

export type MultiStoreOpt = (
	| Required<Pick<cacheManager.StoreConfig, 'ttl'>>
	| Required<Pick<cacheManager.MemoryConfig, 'max'>>
) & {
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
		| (MultiStoreOpt & CacheOptions)
		| {
				default: MultiStoreOpt & CacheOptions;
				local?: MultiStoreOpt | false;
				/**
				 * The global store will ignore the `max` anyway, so avoiding passing it in will help reduce confusion
				 */
				global?: Exclude<MultiStoreOpt, 'max'>;
		  },
	useVersion = true,
): {
	get: (key: string) => Promise<T | undefined>;
	set: (key: string, value: T) => Promise<void>;
	delete: (key: string) => Promise<void>;
	wrap: (key: string, fn: () => Promise<T>) => Promise<T>;
} {
	if (usedCacheKeys[cacheKey] === true) {
		throw new Error(`Cache key '${cacheKey}' has already been taken`);
	}
	usedCacheKeys[cacheKey] = true;

	if (!('default' in opts)) {
		opts = { default: opts };
	}
	const {
		default: {
			isCacheableValue: $isCacheableValue,
			isCacheable: $isCacheable,
			...baseOpts
		},
		local,
		global,
	} = opts;
	const isCacheable = $isCacheable ?? $isCacheableValue;
	const memoryCachePromise =
		local === false
			? undefined
			: cacheManager.caching('memory', { ...baseOpts, ...local, isCacheable });

	const redisOpts = getRedisOptions();
	const cacheOpts: NonNullable<Parameters<typeof redisStore>[0]> = {
		...baseOpts,
		...global,
		...('nodes' in redisOpts ? { clusterConfig: redisOpts } : { redisOpts }),
		isCacheable: (v) =>
			// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
			v != null && (isCacheable == null || isCacheable(v) === true),
	};

	const cachePromise = (async () => {
		const [memoryCache, redisCache] = await Promise.all([
			memoryCachePromise,
			cacheManager.caching(redisStore, cacheOpts),
		]);
		return memoryCache
			? cacheManager.multiCaching([memoryCache, redisCache])
			: redisCache;
	})();

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
			return await (await cachePromise).get(fullKey);
		},
		set: async (key, value) => {
			const fullKey = getKey(key);
			await (await cachePromise).set(fullKey, value);
		},
		delete: async (key) => {
			const fullKey = getKey(key);
			await (await cachePromise).del(fullKey);
		},
		wrap: async (key, fn) => {
			const fullKey = getKey(key);
			return await (await cachePromise).wrap(fullKey, fn);
		},
	};
}
