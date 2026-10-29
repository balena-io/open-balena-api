import { expect } from 'chai';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import {
	createLocker,
	LockReleaseError,
	LockUnavailableError,
} from '../src/infra/lock/index.ts';
import { nodeRedis } from '../src/infra/redis/index.ts';

const getRejection = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error('Expected the promise to be rejected');
};

export default () => {
	describe('Lock', () => {
		const locker = createLocker(nodeRedis, {
			retryCount: 2,
			retryDelay: 50,
			retryJitter: 0,
		});
		let key: string;
		beforeEach(() => {
			key = `test:lock:${randomUUID()}`;
		});
		afterEach(async () => {
			await nodeRedis.del(key);
		});

		it('should hold the key until unlocked', async () => {
			const lock = await locker.lock(key, 10000);
			expect(await nodeRedis.get(key)).to.be.a('string');
			expect(await nodeRedis.pTTL(key)).to.be.within(1, 10000);

			await lock.unlock();
			expect(await nodeRedis.get(key)).to.equal(null);
		});

		it('should allow unlocking more than once', async () => {
			const lock = await locker.lock(key, 10000);
			await lock.unlock();
			await lock.unlock();
		});

		it('should unlock when an `await using` declaration goes out of scope', async () => {
			{
				// eslint-disable-next-line @typescript-eslint/no-unused-vars -- released when it goes out of scope
				await using _lock = await locker.lock(key, 10000);
				expect(await nodeRedis.get(key)).to.be.a('string');
			}
			expect(await nodeRedis.get(key)).to.equal(null);
		});

		it('should fail with a LockUnavailableError once all the retries are used whilst the lock is held', async () => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars -- released when it goes out of scope
			await using _lock = await locker.lock(key, 10000);
			const start = Date.now();
			const err = await getRejection(locker.lock(key, 10000));
			expect(err).to.be.instanceOf(LockUnavailableError);
			// 2 retries, each after a 50ms delay
			expect(Date.now() - start).to.be.at.least(100);
		});

		it('should acquire the lock on a retry if it is released in the meantime', async () => {
			const lock = await locker.lock(key, 10000);
			const secondLock = locker.lock(key, 10000);
			await lock.unlock();
			await (await secondLock).unlock();
		});

		it('should acquire the lock once it has expired', async () => {
			await locker.lock(key, 50);
			await setTimeout(100);
			const lock = await locker.lock(key, 10000);
			await lock.unlock();
		});

		it('should fail with a LockReleaseError and keep the lock when it has expired and been acquired by someone else', async () => {
			const lock = await locker.lock(key, 50);
			await setTimeout(100);
			const otherLock = await locker.lock(key, 10000);
			const otherValue = await nodeRedis.get(key);

			const err = await getRejection(lock.unlock());
			expect(err).to.be.instanceOf(LockReleaseError);
			expect(await nodeRedis.get(key)).to.equal(otherValue);

			await otherLock.unlock();
			expect(await nodeRedis.get(key)).to.equal(null);
		});
	});
};
