import _ from 'lodash';
import * as NodeRedis from 'redis';
import { MINUTES, SECONDS } from '@balena/env-parsing';
import { version } from '../../lib/config.ts';
import type { Defined } from './index.ts';
import { getRedisOptions } from '../redis/config.ts';

const DEFAULT_LOCAL_MAX = 500;
const DEFAULT_LOCAL_TTL = Infinity;
// The largest Smi on builds with 31 bit Smis, eg with pointer compression, which is used as the expiry of entries without
// a ttl so that the expiries of all entries can stay Smis
const NO_EXPIRY = 2 ** 30 - 1;
const LOCAL_SWEEP_INTERVAL = 10 * SECONDS;

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

// All stores share a single connection rather than one each, which also lets node-redis pipeline commands across all
// of them. We create it here rather than using `infra/redis` because importing that also imports pinejs, and this
// module must be importable before pinejs is configured, eg so that pinejs' caches can be set up with it
const createSharedRedis = () => {
	const redisOpts = getRedisOptions();
	let redisClient;
	if ('rootNodes' in redisOpts) {
		redisClient = NodeRedis.createCluster(redisOpts);
	} else {
		redisClient = NodeRedis.createClient(redisOpts);
	}
	const logError = _.throttle((err: Error) => {
		// We cannot use `captureException` as importing it also imports pinejs
		console.error('Multi level store redis error', err);
	}, 5 * MINUTES);
	// If not handled will crash the process
	redisClient.on('error', logError);
	// We cannot wait for the connection here, but commands fail rather than queueing whilst it is not ready
	redisClient.connect().catch(logError);
	return redisClient;
};
let sharedRedis: ReturnType<typeof createSharedRedis> | undefined;
const getSharedRedis = () => {
	sharedRedis ??= createSharedRedis();
	return sharedRedis;
};

/**
 * Whole seconds since the process started, which stays a Smi so that storing it per entry does not need a HeapNumber
 * like a millisecond timestamp would. A timer updates it twice a second because reading the clock was a large part of
 * the cost of a local hit, and it reads the clock rather than counting ticks because timers run late, which would add up
 * and make entries outlive their ttl by more the longer the ttl
 */
const readNowSeconds = () => Math.floor(process.uptime());
let nowSeconds = readNowSeconds();
setInterval(() => {
	nowSeconds = readNowSeconds();
}, 500).unref();

/**
 * A plain Map LRU with a ttl, which avoids the cost of generic machinery on such a hot path. Maps iterate in insertion
 * order, so re-inserting on every hit keeps the least recently used entry first
 */
class LocalCache<T> {
	private entries = new Map<string, { value: T; expiresAt: number }>();
	private max;
	private ttl;
	/**
	 * Kept between evictions because a new iterator has to step over every deleted slot at the front of the map, and
	 * those build up until V8 next rehashes it, which made each eviction from a full 100k entry cache take ~10-100µs.
	 * Every entry before it has been evicted, as entries are only ever added at the back
	 */
	private evictionCursor: MapIterator<string> | undefined;
	/** @param ttl In whole seconds, or `Infinity` for no expiry */
	constructor(max: number, ttl: number) {
		this.max = max;
		this.ttl = ttl;
	}

	public get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) {
			return;
		}
		this.entries.delete(key);
		// Expiring only once the current second is past `expiresAt` means entries live for at least their ttl, less the half
		// a second that `nowSeconds` can lag behind the clock
		if (entry.expiresAt < nowSeconds) {
			return;
		}
		this.entries.set(key, entry);
		return entry.value;
	}

	public set(key: string, value: T) {
		this.entries.delete(key);
		if (this.entries.size >= this.max) {
			let oldest = this.evictionCursor?.next();
			if (oldest == null || oldest.done) {
				this.evictionCursor = this.entries.keys();
				oldest = this.evictionCursor.next();
			}
			this.entries.delete(oldest.value!);
		}
		this.entries.set(key, {
			value,
			expiresAt: this.ttl === Infinity ? NO_EXPIRY : nowSeconds + this.ttl,
		});
	}

	public delete(key: string) {
		this.entries.delete(key);
	}

	/**
	 * Removes expired entries from the front, stopping at the first live one. Hits move entries to the back without
	 * extending their expiry, so a few expired entries can be left behind it, but those are removed once they are next
	 * read or reach the front
	 */
	public sweep() {
		// An idle iterator keeps every table that V8 has since replaced, and their entries, in memory
		this.evictionCursor = undefined;
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt >= nowSeconds) {
				return;
			}
			this.entries.delete(key);
		}
	}
}

// Expired entries would otherwise stay in memory until they are read again or are evicted by `max`, which for keys
// that are only read once means until the cache fills. A single timer sweeps all the caches, rather than one per cache,
// including those without a ttl so that their eviction cursor is released
const sweptLocalCaches = new Set<LocalCache<unknown>>();
let localSweepInterval: ReturnType<typeof setInterval> | undefined;
const sweepExpiredLocalEntries = (localCache: LocalCache<unknown>) => {
	sweptLocalCaches.add(localCache);
	localSweepInterval ??= setInterval(() => {
		for (const cache of sweptLocalCaches) {
			cache.sweep();
		}
	}, LOCAL_SWEEP_INTERVAL).unref();
};

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
		// A max of 0 uses the default, as does a ttl of 0 for no expiry, the same as cache-manager's memory store. The local
		// expiry is only tracked to the second, so a fractional ttl is rounded up
		localCache = new LocalCache(
			max == null || max === 0 ? DEFAULT_LOCAL_MAX : max,
			ttl ? Math.ceil(ttl) : DEFAULT_LOCAL_TTL,
		);
		sweepExpiredLocalEntries(localCache);
	}
	const { ttl: sharedTtl, refreshThreshold } = { ...baseOpts, ...global };
	// redis cannot cache undefined/null values whilst others can, so we explicitly mark those as uncacheable
	const isSharedCacheable = (value: unknown): value is T =>
		value != null &&
		(isCacheableValue == null || isCacheableValue(value) === true);
	const redis = getSharedRedis();

	// Only the shared cache needs the prefix to separate it from other stores, the local cache belongs to this store alone
	// so it uses the bare key, which avoids the memory of the prefix and building the string on a local hit
	let keyPrefix: string;
	const getSharedKey = (key: string) => {
		// We include the version so that we get automatic invalidation on updates which might change the memoized fn behavior,
		// we also calculate the keyPrefix lazily so that the version has a chance to be set as otherwise the memoized function
		// creation can happen before the version has been initialized
		keyPrefix ??= `cache$${useVersion ? version : ''}$${cacheKey}$`;
		return `${keyPrefix}${key}`;
	};

	const getShared = async (key: string) => {
		const json = await redis.get(getSharedKey(key));
		if (json == null) {
			return;
		}
		const value = JSON.parse(json);
		if (!isSharedCacheable(value)) {
			return;
		}
		return { value, json };
	};

	const setAll = async (key: string, value: T) => {
		localCache?.set(
			key,
			typeof value === 'object' && value !== null ? _.cloneDeep(value) : value,
		);
		if (isSharedCacheable(value)) {
			const json = JSON.stringify(value) ?? '"undefined"';
			const sharedKey = getSharedKey(key);
			if (sharedTtl) {
				await redis.set(sharedKey, json, {
					expiration: { type: 'EX', value: sharedTtl },
				});
			} else {
				await redis.set(sharedKey, json);
			}
		}
	};

	const refreshing = new Set<string>();
	const refreshInBackground = (key: string, fn: () => T | Promise<T>): void => {
		if (!refreshThreshold || refreshing.has(key)) {
			return;
		}
		refreshing.add(key);
		void (async () => {
			try {
				const ttl = await redis.ttl(getSharedKey(key));
				if (refreshThreshold > ttl) {
					const value = await fn();
					if (value !== undefined) {
						await setAll(key, value);
					}
				}
			} catch {
				// A failed refresh is ignored, the entry will be fetched again once it expires
			} finally {
				refreshing.delete(key);
			}
		})();
	};

	const fetchAndSet = async (
		key: string,
		fn: () => T | Promise<T>,
	): Promise<T> => {
		const value = await fn();
		if (localCache == null ? !isSharedCacheable(value) : value === undefined) {
			return value;
		}
		await setAll(key, value);
		return value;
	};
	// Concurrent misses for the same key share a single fetch
	const pendingFetches = new Map<string, Promise<T>>();

	return {
		get: async (key) => {
			const localValue = localCache?.get(key);
			if (localValue !== undefined) {
				return localValue;
			}
			// Unlike `wrap`, a value fetched from redis by `get` is not added to the local cache
			return (await getShared(key))?.value;
		},
		set: async (key, value) => {
			if (localCache == null && !isSharedCacheable(value)) {
				throw new Error(`"${value}" is not a cacheable value`);
			}
			await setAll(key, value);
		},
		delete: async (key) => {
			localCache?.delete(key);
			await redis.del(getSharedKey(key));
		},
		wrap: async (key, fn) => {
			const localValue = localCache?.get(key);
			if (localValue !== undefined) {
				return localValue;
			}
			const shared = await getShared(key);
			if (shared != null) {
				refreshInBackground(key, fn);
				// Parsing the json again gives the local cache its own copy more cheaply than cloning
				localCache?.set(
					key,
					typeof shared.value === 'object'
						? JSON.parse(shared.json)
						: shared.value,
				);
				return shared.value;
			}
			let pending = pendingFetches.get(key);
			if (pending == null) {
				pending = fetchAndSet(key, fn).finally(() => {
					pendingFetches.delete(key);
				});
				pendingFetches.set(key, pending);
			}
			return await pending;
		},
	};
}
