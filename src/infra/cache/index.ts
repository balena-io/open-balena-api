import * as cacheManager from 'cache-manager';
import redisStore = require('cache-manager-redis-store');
import primitiveKey = require('memoizee/normalizers/primitive');
import { REDIS_HOST, REDIS_PORT } from '../../lib/config';
import { promisify } from 'util';
import { version } from '../../lib/config';

/**
 * A multi layer cache compatible with a subset of memoizee options
 * Note: `undefined`/`null` can only be locally cached so avoid if possible
 */
export const multiCacheMemoizee = <T extends (...args: any[]) => any>(
	fn: T,
	opts: {
		cacheKey?: string;
		promise: true;
		primitive: true;
		preFetch?: true | number;
		maxAge: number;
		max?: number;
	},
) => {
	const {
		cacheKey = fn.name,
		promise,
		primitive,
		preFetch,
		maxAge,
		max,
		...remaining
	} = opts;
	const remainingKeys = Object.keys(remaining);
	if (remainingKeys.length > 0) {
		throw new Error(`Unsupported options: ${remainingKeys}`);
	}
	if (promise !== true) {
		throw new Error('Only promise mode memoization is supported');
	}
	if (primitive !== true) {
		throw new Error('Only primitive mode memoization is supported');
	}
	if (cacheKey === '') {
		throw new Error(
			'cacheKey cannot be empty, this can happen if you use an anonymous function and do not manually specify a cacheKey',
		);
	}

	let refreshThreshold;
	if (preFetch != null) {
		refreshThreshold = maxAge * (preFetch === true ? 0.333 : preFetch);
	}
	return multiCache(fn, cacheKey, {
		ttl: maxAge,
		max,
		refreshThreshold,
		// Treat everything as cacheable, including `undefined` - the same as memoizee
		isCacheableValue: () => true,
	});
};

const usedCacheKeys: Dictionary<true> = {};
const multiCache = <T extends (...args: any[]) => any>(
	fn: T,
	cacheKey: string,
	opts: Pick<cacheManager.StoreConfig, 'ttl' | 'max'> & {
		refreshThreshold?: number;
	} & cacheManager.CacheOptions,
) => {
	if (usedCacheKeys[cacheKey] === true) {
		throw new Error(`Cache key '${cacheKey}' has already been taken`);
	}
	usedCacheKeys[cacheKey] = true;

	const { isCacheableValue } = opts;
	const memoryCache = cacheManager.caching({ ...opts, store: 'memory' });
	const redisCache = cacheManager.caching({
		...opts,
		store: redisStore,
		host: REDIS_HOST,
		port: REDIS_PORT,
		// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
		isCacheableValue: (v) => v != null && isCacheableValue?.(v) === true,
	});
	const cache = cacheManager.multiCaching([memoryCache, redisCache]);

	// We include the version so that we get automatic invalidation on updates which might change the memoized fn behavior
	const keyPrefix = `cache$${version}$${cacheKey}$`;
	const memoizedFn = async (...args: Parameters<T>) => {
		const key = `${keyPrefix}${primitiveKey(args)}`;
		return await cache.wrap<ResolvableReturnType<T>>(key, async () => {
			return await fn(...args);
		});
	};

	memoizedFn.clear = promisify(cache.reset);

	return memoizedFn;
};
