import _ from 'lodash';
import { Redis } from 'ioredis';
import type { Cluster } from 'ioredis';
import { version } from '../../lib/config.js';
import type { Defined } from './index.js';
import { getRedisOptions } from '../redis/config.js';

const usedCacheKeys = new Set<string>();

export type MultiStoreOpt = {
	/** In seconds, with `0`/`undefined` meaning entries do not expire */
	ttl?: number;
	/** Only applies to the local cache, defaults to 500 */
	max?: number;
	/**
	 * In seconds, when an entry is fetched from the shared cache with less than this left then it is refreshed in the
	 * background
	 */
	refreshThreshold?: number;
};

// All stores share a single connection rather than one each, which also lets ioredis auto-pipeline commands across
// all of them. We create it here rather than using `infra/redis` because importing that also imports pinejs, and this
// module must be importable before pinejs is configured, eg so that pinejs' caches can be set up with it
let sharedRedis: Redis | Cluster | undefined;
const getSharedRedis = () => {
	if (sharedRedis == null) {
		const redisOpts = getRedisOptions();
		sharedRedis =
			'nodes' in redisOpts
				? new Redis.Cluster(redisOpts.nodes, redisOpts.options)
				: new Redis(redisOpts);
	}
	return sharedRedis;
};

/**
 * A plain Map LRU with a ttl, which avoids the cost of generic machinery on such a hot path. Maps iterate in insertion
 * order, so re-inserting on every hit keeps the least recently used entry first
 */
class LocalCache<T> {
	private entries = new Map<string, { value: T; expiresAt: number }>();
	constructor(
		private max: number,
		private ttlMs: number,
	) {}

	public get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) {
			return;
		}
		this.entries.delete(key);
		if (entry.expiresAt <= Date.now()) {
			return;
		}
		this.entries.set(key, entry);
		return entry.value;
	}

	public set(key: string, value: T) {
		this.entries.delete(key);
		if (this.entries.size >= this.max) {
			this.entries.delete(this.entries.keys().next().value!);
		}
		this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
	}

	public delete(key: string) {
		this.entries.delete(key);
	}
}

/**
 * A local in-memory cache in front of a shared redis cache. Values are stored in redis as JSON, and the local cache
 * keeps its own copy of each value so that mutating a returned value cannot change what is cached
 */
export function createMultiLevelStore<T extends Defined>(
	cacheKey: string,
	opts: {
		default: MultiStoreOpt & {
			/** Whether a value should be cached, `null`/`undefined` are never cached in redis */
			isCacheableValue?: (value: any) => boolean;
		};
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
	if (usedCacheKeys.has(cacheKey)) {
		throw new Error(`Cache key '${cacheKey}' has already been taken`);
	}
	usedCacheKeys.add(cacheKey);

	const { default: baseOpts, local, global, useVersion } = opts;
	const { isCacheableValue } = baseOpts;
	let localCache: LocalCache<T> | undefined;
	if (local !== false) {
		const { max, ttl } = { ...baseOpts, ...local };
		// A max of 0 uses the default, as does a ttl of 0 for no expiry, the same as cache-manager's memory store
		localCache = new LocalCache(
			max == null || max === 0 ? 500 : max,
			ttl ? ttl * 1000 : Infinity,
		);
	}
	const { ttl: sharedTtl, refreshThreshold } = { ...baseOpts, ...global };
	// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
	const isSharedCacheable = (value: unknown): value is T =>
		value != null &&
		(isCacheableValue == null || isCacheableValue(value) === true);
	const redis = getSharedRedis();

	let keyPrefix: string;
	const getKey = (key: string) => {
		// We include the version so that we get automatic invalidation on updates which might change the memoized fn behavior,
		// we also calculate the keyPrefix lazily so that the version has a chance to be set as otherwise the memoized function
		// creation can happen before the version has been initialized
		keyPrefix ??= `cache$${useVersion ? version : ''}$${cacheKey}$`;
		return `${keyPrefix}${key}`;
	};

	const getShared = async (fullKey: string) => {
		const json = await redis.get(fullKey);
		if (json == null) {
			return;
		}
		const value = JSON.parse(json);
		if (!isSharedCacheable(value)) {
			return;
		}
		return { value, json };
	};

	const setAll = async (fullKey: string, value: T) => {
		localCache?.set(
			fullKey,
			typeof value === 'object' && value !== null ? _.cloneDeep(value) : value,
		);
		if (isSharedCacheable(value)) {
			const json = JSON.stringify(value) ?? '"undefined"';
			if (sharedTtl) {
				await redis.setex(fullKey, sharedTtl, json);
			} else {
				await redis.set(fullKey, json);
			}
		}
	};

	const refreshing = new Set<string>();
	const refreshInBackground = (
		fullKey: string,
		fn: () => T | Promise<T>,
	): void => {
		if (!refreshThreshold || refreshing.has(fullKey)) {
			return;
		}
		refreshing.add(fullKey);
		void (async () => {
			try {
				const ttl = await redis.ttl(fullKey);
				if (refreshThreshold > ttl) {
					const value = await fn();
					if (value !== undefined) {
						await setAll(fullKey, value);
					}
				}
			} catch {
				// A failed refresh is ignored, the entry will be fetched again once it expires
			} finally {
				refreshing.delete(fullKey);
			}
		})();
	};

	const fetchAndSet = async (
		fullKey: string,
		fn: () => T | Promise<T>,
	): Promise<T> => {
		const value = await fn();
		if (localCache == null ? !isSharedCacheable(value) : value === undefined) {
			return value;
		}
		await setAll(fullKey, value);
		return value;
	};
	// Concurrent misses for the same key share a single fetch
	const pendingFetches = new Map<string, Promise<T>>();

	return {
		get: async (key) => {
			const fullKey = getKey(key);
			const localValue = localCache?.get(fullKey);
			if (localValue !== undefined) {
				return localValue;
			}
			// Unlike `wrap`, a value fetched from redis by `get` is not added to the local cache
			return (await getShared(fullKey))?.value;
		},
		set: async (key, value) => {
			const fullKey = getKey(key);
			if (localCache == null && !isSharedCacheable(value)) {
				throw new Error(`"${value}" is not a cacheable value`);
			}
			await setAll(fullKey, value);
		},
		delete: async (key) => {
			const fullKey = getKey(key);
			localCache?.delete(fullKey);
			await redis.del(fullKey);
		},
		wrap: async (key, fn) => {
			const fullKey = getKey(key);
			const localValue = localCache?.get(fullKey);
			if (localValue !== undefined) {
				return localValue;
			}
			const shared = await getShared(fullKey);
			if (shared != null) {
				refreshInBackground(fullKey, fn);
				// Parsing the json again gives the local cache its own copy more cheaply than cloning
				localCache?.set(
					fullKey,
					typeof shared.value === 'object'
						? JSON.parse(shared.json)
						: shared.value,
				);
				return shared.value;
			}
			let pending = pendingFetches.get(fullKey);
			if (pending == null) {
				pending = fetchAndSet(fullKey, fn).finally(() => {
					pendingFetches.delete(fullKey);
				});
				pendingFetches.set(fullKey, pending);
			}
			return await pending;
		},
	};
}
