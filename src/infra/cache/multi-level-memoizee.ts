import type { types } from '@balena/pinejs';
import _ from 'lodash';
import type { Options as MemoizeeOptions } from 'memoizee';
import primitiveKey from 'memoizee/normalizers/primitive.js';
import { SECONDS } from '@balena/env-parsing';
import type { Defined, MultiStoreOpt } from './index.js';
import { createMultiLevelStore } from './index.js';

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

const memoizeeExtraOptionsKeys = ['max', 'maxAge', 'preFetch'] as const;

type AnyFunction = (...args: any[]) => any;

type SharedMultiCacheMemoizeeExtraOpts<T extends AnyFunction> = Exclude<
	Partial<MultiCacheMemoizeeExtraOpts<T>>,
	'max'
>;

type MultiCacheMemoizeeExtraOpts<T extends AnyFunction> = Pick<
	MultiCacheMemoizeeOpts<T>,
	(typeof memoizeeExtraOptionsKeys)[number]
>;

const checkUnsupportedExtraCacheKeys = (
	opts: Partial<MultiCacheMemoizeeExtraOpts<any>> | undefined,
	cacheType: string,
) => {
	if (opts == null) {
		return;
	}
	const remainingKeys = _.without(
		Object.keys(opts),
		...memoizeeExtraOptionsKeys,
	);
	if (remainingKeys != null && remainingKeys.length > 0) {
		throw new Error(`Unsupported ${cacheType} cache options: ${remainingKeys}`);
	}
};

export interface MemoizedFn<T extends (...args: any[]) => Promise<any>> {
	(...args: Parameters<T>): Promise<ResolvableReturnType<T>>;
	delete: (...args: Parameters<T>) => Promise<void>;
}

// TODO: Move these to common-types.ts once we make them part of the build output.
// This makes TS emit a union of `Record<K, T[K]>` for each `keyof T`.
type ToSinglePropUnions<T> = { [K in keyof T]: Record<K, T[K]> }[keyof T];
// Requires at least one of the properties of T to be defined aka NonEmptyPartial.
type AtLeastOneProp<T> = Partial<T> & ToSinglePropUnions<T>;

// The AtLeastOneProp makes the empty object only assignable to SharedMultiCacheMemoizeeExtraOpts so that
// we can use use `'local'|'global' in opts` to discriminate which of the two types of the union we have on hand.
type ExtraCacheOptsByType<T extends AnyFunction> = AtLeastOneProp<{
	local: Partial<MultiCacheMemoizeeExtraOpts<T>> | false;
	global: SharedMultiCacheMemoizeeExtraOpts<T>;
}> &
	Pick<Parameters<typeof createMultiLevelStore>[1], 'useVersion'>;

type ExtraCacheOpts<T extends AnyFunction> =
	| ExtraCacheOptsByType<T>
	// TODO: Drop SharedMultiCacheMemoizeeExtraOpts from the union in the next major and switch AtLeastOneProp to a plain Partial
	/**
	 * @deprecated
	 */
	| SharedMultiCacheMemoizeeExtraOpts<T>;

/**
 * A multi layer cache compatible with a subset of memoizee options
 * Note: `undefined`/`null` can only be locally cached so avoid if possible
 *
 * @example
 * multiCacheMemoizee('test', {
 * 	maxAge: 24 * HOURS,
 * }, {
 * 	local: false, // Disable the local cache
 * });
 *
 * @example
 * multiCacheMemoizee('test', {
 * 	maxAge: 1 * HOURS,
 * }, {
 * 	global: {
 * 		maxAge: 24 * HOURS, // override the shared cache (redis) ttl
 * 	}
 * });
 *
 * @example
 * // deprecated extraCacheOpts notation
 * multiCacheMemoizee('test', {
 * 	maxAge: 1 * HOURS,
 * }, {
 * 	maxAge: 24 * HOURS, // override the shared cache (redis) ttl
 * });
 */
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined | undefined>,
>(
	fn: T,
	opts: types.RequiredField<MultiCacheMemoizeeOpts<T>, 'undefinedAs'>,
	extraCacheOpts?: ExtraCacheOptsByType<T>,
): MemoizedFn<T>;
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	extraCacheOpts?: ExtraCacheOptsByType<T>,
): MemoizedFn<T>;
/**
 * @deprecated
 */
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined | undefined>,
>(
	fn: T,
	opts: types.RequiredField<MultiCacheMemoizeeOpts<T>, 'undefinedAs'>,
	extraCacheOpts?: SharedMultiCacheMemoizeeExtraOpts<T>,
): MemoizedFn<T>;
/**
 * @deprecated
 */
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	extraCacheOpts?: SharedMultiCacheMemoizeeExtraOpts<T>,
): MemoizedFn<T>;
export function multiCacheMemoizee<
	T extends (...args: any[]) => Promise<Defined | undefined>,
>(
	fn: T,
	opts: MultiCacheMemoizeeOpts<T>,
	extraCacheOpts?: ExtraCacheOpts<T>,
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

	const extraCacheOptsByType =
		extraCacheOpts != null &&
		!('local' in extraCacheOpts) &&
		!('global' in extraCacheOpts)
			? {
					global: extraCacheOpts,
				}
			: extraCacheOpts;

	if (extraCacheOptsByType?.local !== false) {
		checkUnsupportedExtraCacheKeys(extraCacheOptsByType?.local, 'local');
	}
	checkUnsupportedExtraCacheKeys(extraCacheOptsByType?.global, 'shared');

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
		local:
			extraCacheOptsByType?.local === false
				? false
				: convertToMultiStoreOpts({ ...opts, ...extraCacheOptsByType?.local }),
		global: convertToMultiStoreOpts({
			...opts,
			...extraCacheOptsByType?.global,
		}),
		useVersion: extraCacheOptsByType?.useVersion,
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
			return valueToCache ?? undefinedAs;
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
