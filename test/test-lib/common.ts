import { setTimeout } from 'timers/promises';
import { TypedError } from 'typed-error';

type PredicateFunction = () => Resolvable<boolean>;

export class TimedOutError extends TypedError {}

/**
 * Loops `maxCount` times, calling the `checkFn` predicate. Returning `TRUE` from the
 * predicate will cease the looping. If `FALSE` then we delay by `delayMs` milliseconds.
 *
 * If we haven't seen a `TRUE` when the loop finishes, we throw a {@link TimedOutError}
 *
 * @export
 * @param {number} delayMs
 * @param {number} maxCount
 * @param {PredicateFunction} checkFn
 */
export async function waitFor({
	delayMs = 100,
	maxCount = 100,
	checkFn,
}: {
	delayMs?: number;
	maxCount?: number;
	checkFn: PredicateFunction;
}) {
	for (let i = 1; i <= maxCount; i++) {
		console.log(`⌚  Waiting (${i}/${maxCount})...`);
		await setTimeout(delayMs);

		if (await checkFn()) {
			return;
		}
	}

	throw new TimedOutError();
}
