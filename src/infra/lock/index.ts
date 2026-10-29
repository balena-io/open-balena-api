/*
	Redis Lock Library

	A lock on a single redis instance, a key that is set with `SET NX PX` to a random value that is
	unique to the lock holder, and that is only deleted if it still holds that value.

	Using this lib:
		- create a locker with `createLocker()`, passing the redis client and retry settings.
		- call `locker.lock()` with a key and a ttl, the ttl should be longer than the work that is
		  being protected as the lock is automatically released when it expires.
		- release the lock with `lock.unlock()`, or by declaring it with `await using`.
*/

import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { stripIndent } from 'common-tags';
import { TypedError } from 'typed-error';
import type { nodeRedis } from '../redis/index.ts';

export class LockUnavailableError extends TypedError {}
export class LockReleaseError extends TypedError {}

export interface Lock extends AsyncDisposable {
	unlock(): Promise<void>;
}

export interface LockSettings {
	/** The number of times to retry acquiring the lock after the first attempt */
	retryCount: number;
	/** The delay in milliseconds between attempts */
	retryDelay: number;
	/** The maximum number of milliseconds to randomly add to or subtract from `retryDelay` */
	retryJitter: number;
}

const releaseScript = stripIndent`
	-- Only remove the lock if it is still held by this lock holder
	if redis.call("get", KEYS[1]) == ARGV[1] then
		return redis.call("del", KEYS[1])
	end
	return 0`;

export const createLocker = (
	client: typeof nodeRedis,
	{ retryCount, retryDelay, retryJitter }: LockSettings,
) => {
	const acquire = async (key: string, value: string, ttl: number) => {
		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= retryCount; attempt++) {
			if (attempt > 0) {
				await setTimeout(
					Math.max(
						0,
						retryDelay + Math.floor((Math.random() * 2 - 1) * retryJitter),
					),
				);
			}
			try {
				const result = await client.set(key, value, {
					condition: 'NX',
					expiration: { type: 'PX', value: ttl },
				});
				if (result != null) {
					return;
				}
				lastError = undefined;
			} catch (err) {
				// Redis errors are retried as well, in case they are transient
				lastError = err;
			}
		}
		throw (
			lastError ??
			new LockUnavailableError(
				`Exceeded ${retryCount} attempts to lock the resource "${key}"`,
			)
		);
	};

	const lock = async (key: string, ttl: number): Promise<Lock> => {
		const value = randomBytes(16).toString('hex');
		await acquire(key, value, ttl);

		let released = false;
		const unlock = async () => {
			if (released) {
				return;
			}
			released = true;
			const removed = await client.eval(releaseScript, {
				keys: [key],
				arguments: [value],
			});
			if (removed !== 1) {
				// The lock has expired, and may have been acquired by someone else
				throw new LockReleaseError(
					`Unable to release the lock on resource "${key}" as it is no longer held`,
				);
			}
		};
		return {
			unlock,
			[Symbol.asyncDispose]: unlock,
		};
	};

	return { lock };
};
