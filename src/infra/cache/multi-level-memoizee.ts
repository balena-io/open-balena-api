import type { types } from '@balena/pinejs';
import _ from 'lodash';
import type { Options as MemoizeeOptions } from 'memoizee';
import primitiveKey from 'memoizee/normalizers/primitive';
import { SECONDS } from '@balena/env-parsing';
import { createMultiLevelStore, Defined, MultiStoreOpt } from '.';

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

const memoizeeSharedOptionsKeys = ['max', 'maxAge', 'preFetch'] as const;

type MultiCacheMemoizeeSharedOpts<T extends (...args: any[]) => any> = Pick<
	Exclude<MultiCacheMemoizeeOpts<T>, 'max'>,
	typeof memoizeeSharedOptionsKeys[number]
>;

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
	sharedCacheOpts?: Partial<MultiCacheMemoizeeSharedOpts<T>>,
): MemoizedFn<T>;
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	sharedCacheOpts?: Partial<MultiCacheMemoizeeSharedOpts<T>>,
): MemoizedFn<T>;
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined | undefined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	sharedCacheOpts?: Partial<MultiCacheMemoizeeSharedOpts<T>>,
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
			? _.without(Object.keys(sharedCacheOpts), ...memoizeeSharedOptionsKeys)
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

	const convertToMultiStoreOpts = (
		options: MultiCacheMemoizeeOpts<T>,
	): MultiStoreOpt => {
		// ttl is in seconds, so we need to divide by 1000
		const ttl = options.maxAge / SECONDS;
		return {
			ttl,
			max: options.max,
			refreshThreshold:
				options.preFetch != null
					? ttl * (options.preFetch === true ? 0.333 : options.preFetch)
					: undefined,
			// Treat everything as cacheable, including `undefined` - the same as memoizee
		};
	};

	const multiCacheOpts: Parameters<typeof createMultiLevelStore>[1] = {
		default: { ...convertToMultiStoreOpts(opts), isCacheableValue: () => true },
		global: convertToMultiStoreOpts({ ...opts, ...sharedCacheOpts }),
	};

	return multiCache(fn, cacheKey, normalizer, multiCacheOpts, undefinedAs);
}

/**
 * @param undefinedAs - The value to use as a proxy for undefined in order to support caches that cannot handle undefined
 */
function multiCache<T extends (...args: any[]) => Promise<Defined | undefined>>(
	fn: T,
	cacheKey: string,
	normalizer: NonNullable<MemoizeeOptions<T>['normalizer']>,
	opts: Parameters<typeof createMultiLevelStore>[1],
	undefinedAs?: Defined,
): MemoizedFn<T>;
function multiCache<T extends (...args: any[]) => Promise<Defined>>(
	fn: T,
	cacheKey: string,
	normalizer: NonNullable<MemoizeeOptions<T>['normalizer']>,
	opts: Parameters<typeof createMultiLevelStore>[1],
	undefinedAs?: undefined,
): MemoizedFn<T>;
function multiCache<T extends (...args: any[]) => Promise<Defined | undefined>>(
	fn: T,
	cacheKey: string,
	normalizer: NonNullable<MemoizeeOptions<T>['normalizer']>,
	opts: Parameters<typeof createMultiLevelStore>[1],
	undefinedAs?: Defined,
): MemoizedFn<T> {
	const cache = createMultiLevelStore(cacheKey, opts);

	const getKey = (...args: Parameters<T>) => {
		return normalizer(args);
	};
	const memoizedFn = async (...args: Parameters<T>) => {
		const key = getKey(...args);
		const valueFromCache = await cache.wrap(key, async () => {
			const valueToCache = await fn(...args);
			// Some caches (eg redis) cannot handle caching undefined/null so we convert it to the `undefinedAs` proxy value
			// which will be used when storing in the cache and then convert it back to undefined when retrieving from the cache
			return valueToCache === undefined ? undefinedAs : valueToCache;
		});
		return valueFromCache === undefinedAs ? undefined : valueFromCache;
	};

	memoizedFn.delete = async (...args: Parameters<T>) => {
		const key = getKey(...args);
		await cache.delete(key);
	};

	// We need to cast because the `undefinedAs` handling makes typescript think we've reintroduced undefined
	// but we've only reintroduced it if it was previously undefined
	return memoizedFn as MemoizedFn<T>;
}
