import type { types } from '@balena/pinejs';
import * as _ from 'lodash';
import * as cacheManager from 'cache-manager';
import redisStore = require('cache-manager-redis-store');
import type { Options as MemoizeeOptions } from 'memoizee';
import primitiveKey = require('memoizee/normalizers/primitive');
import { REDIS_HOST, REDIS_PORT, SECONDS, version } from '../../lib/config';

export type Defined = string | number | boolean | symbol | bigint | object;

type MultiCacheMemoizeeOpts<T extends (...args: any[]) => any> = {
	cacheKey?: string;
	undefinedAs?: Defined;
	promise: true;
	primitive: true;
	/** In milliseconds like memoizee */
	maxAge: number;
	/** This only applies to the local in-memory cache, the shared cache is unbounded */
	max?: MemoizeeOptions<T>['max'];
} & Pick<MemoizeeOptions<T>, 'preFetch' | 'normalizer'>;

export interface MemoizedFn<T extends (...args: any[]) => Promise<any>> {
	(...args: Parameters<T>): Promise<ResolvableReturnType<T>>;
	delete: (...args: Parameters<T>) => Promise<void>;
}

/**
 * A multi layer cache compatible with a subset of memoizee options
 * Note: `undefined`/`null` can only be locally cached so avoid if possible
 */
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined | undefined>,
>(
	fn: T,
	opts: types.RequiredField<MultiCacheMemoizeeOpts<T>, 'undefinedAs'>,
	sharedCacheOpts?: Partial<Pick<MultiCacheMemoizeeOpts<T>, 'max' | 'maxAge'>>,
): MemoizedFn<T>;
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	sharedCacheOpts?: Partial<Pick<MultiCacheMemoizeeOpts<T>, 'max' | 'maxAge'>>,
): MemoizedFn<T>;
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined | undefined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	sharedCacheOpts?: Partial<Pick<MultiCacheMemoizeeOpts<T>, 'max' | 'maxAge'>>,
): MemoizedFn<T> {
	const {
		cacheKey = fn.name,
		undefinedAs,
		promise,
		primitive,
		preFetch,
		maxAge,
		max,
		normalizer = primitiveKey,
		...remaining
	} = opts;
	const remainingKeys = Object.keys(remaining);
	if (remainingKeys.length > 0) {
		throw new Error(`Unsupported options: ${remainingKeys}`);
	}
	const remainingSharedCacheKeys =
		sharedCacheOpts != null
			? _.without(Object.keys(sharedCacheOpts), 'max', 'maxAge')
			: null;
	if (remainingSharedCacheKeys != null && remainingSharedCacheKeys.length > 0) {
		throw new Error(`Unsupported shared cache options: ${remainingKeys}`);
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

	const multiCacheOpts = [opts, { ...opts, ...sharedCacheOpts }].map(
		(options): MultiCacheOpt => {
			let refreshThreshold;
			if (options.preFetch != null) {
				refreshThreshold =
					options.maxAge *
					(options.preFetch === true ? 0.333 : options.preFetch);
			}
			return {
				// ttl is in seconds, so we need to divide by 1000
				ttl: options.maxAge / SECONDS,
				max: options.max,
				refreshThreshold,
				// Treat everything as cacheable, including `undefined` - the same as memoizee
				isCacheableValue: () => true,
			};
		},
	);

	return multiCache(fn, cacheKey, normalizer, multiCacheOpts, undefinedAs);
}

const usedCacheKeys: Dictionary<true> = {};

type MultiCacheOpt = Pick<cacheManager.StoreConfig, 'ttl' | 'max'> & {
	refreshThreshold?: number;
} & cacheManager.CacheOptions;

/**
 * @param undefinedAs - The value to use as a proxy for undefined in order to support caches that cannot handle undefined
 */
function multiCache<T extends (...args: any[]) => Promise<Defined | undefined>>(
	fn: T,
	cacheKey: string,
	normalizer: NonNullable<MemoizeeOptions<T>['normalizer']>,
	opts: MultiCacheOpt[],
	undefinedAs?: Defined,
): MemoizedFn<T>;
function multiCache<T extends (...args: any[]) => Promise<Defined>>(
	fn: T,
	cacheKey: string,
	normalizer: NonNullable<MemoizeeOptions<T>['normalizer']>,
	opts: MultiCacheOpt[],
	undefinedAs?: undefined,
): MemoizedFn<T>;
function multiCache<T extends (...args: any[]) => Promise<Defined | undefined>>(
	fn: T,
	cacheKey: string,
	normalizer: NonNullable<MemoizeeOptions<T>['normalizer']>,
	opts: MultiCacheOpt[],
	undefinedAs?: Defined,
): MemoizedFn<T> {
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
	const getKey = (...args: Parameters<T>) => {
		// We include the version so that we get automatic invalidation on updates which might change the memoized fn behavior,
		// we also calculate the keyPrefix lazily so that the version has a chance to be set as otherwise the memoized function
		// creation can happen before the version has been initialized
		keyPrefix ??= `cache$${version}$${cacheKey}$`;
		return `${keyPrefix}${normalizer(args)}`;
	};
	const memoizedFn = async (...args: Parameters<T>) => {
		const key = getKey(...args);
		const valueFromCache = await cache.wrap<ResolvableReturnType<T>>(
			key,
			async () => {
				const valueToCache = await fn(...args);
				// Some caches (eg redis) cannot handle caching undefined/null so we convert it to the `undefinedAs` proxy value
				// which will be used when storing in the cache and then convert it back to undefined when retrieving from the cache
				return valueToCache === undefined ? undefinedAs : valueToCache;
			},
		);
		return valueFromCache === undefinedAs ? undefined : valueFromCache;
	};

	memoizedFn.delete = async (...args: Parameters<T>) => {
		const key = getKey(...args);
		await cache.del(key);
	};

	// We need to cast because the `undefinedAs` handling makes typescript think we've reintroduced undefined
	// but we've only reintroduced it if it was previously undefined
	return memoizedFn as MemoizedFn<T>;
}
