import { expect } from 'chai';
import { stripIndent } from 'common-tags';
import { setTimeout } from 'timers/promises';
import { TypedError } from 'typed-error';
import { ThisShouldNeverHappenError } from '../../src/infra/error-handling/index.js';

type PredicateFunction = () => Resolvable<boolean>;

export class TimedOutError extends TypedError {}

/**
 * Loops for ~`maxWait` ms or `maxCount` times (`maxWait` takes precedence when provided),
 * calling the `checkFn` predicate. Returning `TRUE` from the
 * predicate will cease the looping. If `FALSE` then we delay by `delayMs` milliseconds.
 *
 * If we haven't seen a `TRUE` when the loop finishes, we throw a {@link TimedOutError}
 */
export async function waitFor({
	delayMs = 100,
	maxWait,
	maxCount = 100,
	checkFn,
}: {
	delayMs?: number;
	maxCount?: number;
	maxWait?: number;
	checkFn: PredicateFunction;
}) {
	if (maxWait != null) {
		if (delayMs > maxWait / 10) {
			// wait at least 10ms
			delayMs = Math.max(maxWait / 10, 10);
		}
		maxCount = Math.ceil(maxWait / delayMs);
	}

	const promises: Array<Promise<any>> = [
		(async () => {
			for (let i = 1; i <= maxCount; i++) {
				console.log(`⌚  Waiting ${delayMs}ms (${i}/${maxCount})...`);
				await setTimeout(delayMs);

				if (await checkFn()) {
					return;
				}
			}

			throw new TimedOutError();
		})(),
	];

	if (maxWait != null) {
		promises.push(
			(async () => {
				await setTimeout(maxWait);
				throw new TimedOutError(`Exceeded maxWait ${maxWait}`);
			})(),
		);
	}

	await Promise.race(promises);
}

export const itExpectsError = (
	title: string,
	fn: Mocha.AsyncFunc,
	expectedError: string | RegExp | ((err: Error) => boolean),
) => {
	it(`[Expect test case to fail] ${title}`, async function () {
		try {
			await fn?.call(this);
			throw new Error(stripIndent`
				(Maybe a good one) Test case:
				> ${title}

				that was expected to fail, now completed without issues!
				Confirm whether the test was properly fixed and change its 'itExpectsError()' to an 'it()'.
				Thanks for fixing it!
			`);
		} catch (err) {
			if (!(err instanceof Error)) {
				throw err;
			}
			const isExpectedError =
				typeof expectedError === 'function'
					? expectedError
					: (e: Error) => {
							if (typeof expectedError === 'string') {
								return expectedError === e.message;
							}
							if (expectedError instanceof RegExp) {
								return expectedError.test(e.message);
							}
						};
			if (!isExpectedError(err)) {
				throw err;
			}
		}
	});
};

export function assertExists(v: unknown): asserts v is NonNullable<typeof v> {
	expect(v).to.exist;
}

export async function expectToEventually<T>(
	fn: () => Promise<T>,
	attempts = 20,
	interval = 100,
): Promise<T> {
	let error: Error | undefined;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (e) {
			if (!(e instanceof Error)) {
				throw ThisShouldNeverHappenError(
					'Thrown error is not an instanceof Error',
				);
			}
			error = e;
			console.log(`⌚  Waiting ${interval}ms (${i}/${attempts})...`);
			await setTimeout(interval);
		}
	}
	if (error == null) {
		// error should always be assigned
		throw ThisShouldNeverHappenError('Unexpected test error');
	}
	throw new Error(`Expectation failed: ${error.message}`, { cause: error });
}
