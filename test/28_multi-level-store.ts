import { expect } from 'chai';
import { setTimeout } from 'timers/promises';
import { createMultiLevelStore } from '../src/infra/cache/index.ts';
import { nodeRedis as redis } from '../src/infra/redis/index.ts';
import { version } from '../src/lib/config.ts';

let storeCount = 0;
const getCacheKey = () => `test-multi-level-store-${storeCount++}`;

export default () => {
	describe('multi level store', function () {
		before(async function () {
			// The stores share a connection that doesn't queue commands whilst connecting, so wait until it's ready
			const store = createMultiLevelStore<number>(getCacheKey(), {
				default: {},
				local: false,
				useVersion: false,
			});
			for (let attempt = 1; ; attempt++) {
				try {
					await store.get('ready');
					return;
				} catch (err) {
					if (attempt >= 50) {
						throw err;
					}
					await setTimeout(100);
				}
			}
		});

		it('should cache values in redis as JSON, with the shared ttl', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<{ a: number }>(cacheKey, {
				default: { ttl: 60 },
				global: { ttl: 120 },
				useVersion: false,
			});
			let calls = 0;
			const fn = () => {
				calls++;
				return { a: 1 };
			};
			expect(await store.wrap('key', fn)).to.deep.equal({ a: 1 });
			expect(await store.wrap('key', fn)).to.deep.equal({ a: 1 });
			expect(calls).to.equal(1);

			const redisKey = `cache$$${cacheKey}$key`;
			expect(await redis.get(redisKey)).to.equal('{"a":1}');
			const ttl = await redis.ttl(redisKey);
			expect(ttl).to.be.greaterThan(60).and.at.most(120);
		});

		it('should include the version in the key when useVersion is set', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<number>(cacheKey, {
				default: { ttl: 60 },
				useVersion: true,
			});
			await store.set('key', 1);
			expect(await redis.get(`cache$${version}$${cacheKey}$key`)).to.equal('1');
		});

		it('should share a single fetch between concurrent calls for the same key', async function () {
			const store = createMultiLevelStore<number>(getCacheKey(), {
				default: { ttl: 60 },
				useVersion: false,
			});
			let calls = 0;
			const fn = async () => {
				calls++;
				await setTimeout(50);
				return calls;
			};
			const results = await Promise.all([
				store.wrap('key', fn),
				store.wrap('key', fn),
				store.wrap('key', fn),
			]);
			expect(results).to.deep.equal([1, 1, 1]);
			expect(calls).to.equal(1);
		});

		it('should not cache errors, and should share them between concurrent calls', async function () {
			const store = createMultiLevelStore<number>(getCacheKey(), {
				default: { ttl: 60 },
				useVersion: false,
			});
			let calls = 0;
			const failingFn = async () => {
				calls++;
				await setTimeout(10);
				throw new Error('fetch failed');
			};
			const results = await Promise.allSettled([
				store.wrap('key', failingFn),
				store.wrap('key', failingFn),
			]);
			expect(results.map((r) => r.status)).to.deep.equal([
				'rejected',
				'rejected',
			]);
			expect(calls).to.equal(1);
			expect(await store.wrap('key', () => 2)).to.equal(2);
		});

		it('should copy values from redis into the local cache with wrap but not with get', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<{ a: number }>(cacheKey, {
				default: { ttl: 60 },
				useVersion: false,
			});
			const redisKey = `cache$$${cacheKey}$`;
			await redis.set(`${redisKey}wrapped`, '{"a":1}');
			await redis.set(`${redisKey}got`, '{"a":2}');

			expect(await store.wrap('wrapped', () => ({ a: 0 }))).to.deep.equal({
				a: 1,
			});
			expect(await store.get('got')).to.deep.equal({ a: 2 });

			await redis.del([`${redisKey}wrapped`, `${redisKey}got`]);
			expect(await store.get('wrapped')).to.deep.equal({ a: 1 });
			expect(await store.get('got')).to.equal(undefined);
		});

		it('should not let mutations of returned values change the cached values', async function () {
			const store = createMultiLevelStore<{ a: number }>(getCacheKey(), {
				default: { ttl: 60 },
				useVersion: false,
			});
			const fetched = await store.wrap('key', () => ({ a: 1 }));
			fetched.a = 2;
			const cached = await store.wrap('key', () => ({ a: 3 }));
			expect(cached).to.deep.equal({ a: 1 });
		});

		it('should always read from redis without a local cache', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<number>(cacheKey, {
				default: { ttl: 60 },
				local: false,
				useVersion: false,
			});
			await store.set('key', 1);
			await redis.set(`cache$$${cacheKey}$key`, '2');
			expect(await store.get('key')).to.equal(2);
			expect(await store.wrap('key', () => 3)).to.equal(2);
		});

		it('should read from redis again once the local entry expires', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<number>(cacheKey, {
				default: { ttl: 60 },
				local: { ttl: 0.1 },
				useVersion: false,
			});
			await store.set('key', 1);
			await redis.set(`cache$$${cacheKey}$key`, '2');
			expect(await store.get('key')).to.equal(1);
			await setTimeout(150);
			expect(await store.get('key')).to.equal(2);
		});

		it('should evict the least recently used local entries beyond max', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<number>(cacheKey, {
				default: { ttl: 60 },
				local: { max: 2 },
				useVersion: false,
			});
			await store.set('a', 1);
			await store.set('b', 2);
			// Using `a` makes `b` the least recently used
			expect(await store.get('a')).to.equal(1);
			await store.set('c', 3);
			await redis.del([
				`cache$$${cacheKey}$a`,
				`cache$$${cacheKey}$b`,
				`cache$$${cacheKey}$c`,
			]);
			expect(await store.get('a')).to.equal(1);
			expect(await store.get('b')).to.equal(undefined);
			expect(await store.get('c')).to.equal(3);
		});

		it('should only store cacheable values in redis', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<boolean>(cacheKey, {
				default: {
					ttl: 60,
					isCacheableValue: (value) => value === true,
				},
				local: false,
				useVersion: false,
			});
			let calls = 0;
			const fn = () => {
				calls++;
				return false;
			};
			expect(await store.wrap('key', fn)).to.equal(false);
			expect(await store.wrap('key', fn)).to.equal(false);
			expect(calls).to.equal(2);
			expect(await redis.exists(`cache$$${cacheKey}$key`)).to.equal(0);
			expect(await store.wrap('key', () => true)).to.equal(true);
			expect(await redis.get(`cache$$${cacheKey}$key`)).to.equal('true');
		});

		it('should delete from both caches', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<number>(cacheKey, {
				default: { ttl: 60 },
				useVersion: false,
			});
			await store.set('key', 1);
			await store.delete('key');
			expect(await store.get('key')).to.equal(undefined);
			expect(await redis.exists(`cache$$${cacheKey}$key`)).to.equal(0);
		});

		it('should refresh entries from redis in the background once they are within the refresh threshold', async function () {
			const cacheKey = getCacheKey();
			const store = createMultiLevelStore<number>(cacheKey, {
				default: { ttl: 60, refreshThreshold: 30 },
				local: false,
				useVersion: false,
			});
			const redisKey = `cache$$${cacheKey}$key`;
			await redis.set(redisKey, '1', {
				expiration: { type: 'EX', value: 10 },
			});
			expect(await store.wrap('key', () => 2)).to.equal(1);
			await setTimeout(50);
			expect(await redis.get(redisKey)).to.equal('2');
			expect(await redis.ttl(redisKey)).to.be.greaterThan(30);
		});
	});
};
