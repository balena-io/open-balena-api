// TODO: We should cleanup the data and delete this file.

import type { sbvrUtils } from '@balena/pinejs';
import { hooks, errors as pinejsErrors } from '@balena/pinejs';
import { odataNameToSqlName } from '@balena/odata-to-abstract-sql';

const { BadRequestError } = pinejsErrors;

const vowels = ['a', 'e', 'i', 'o', 'u'];

/**
 * This is a HACH and should only be used when pre-existing data blocks us from adding the respective Necessity directly in the sbvr.
 */
export function addHooksForFieldSizeLimitChecks(
	model: string,
	resource: string,
	fieldSizeLimits: Record<
		string,
		number | { min?: number; max: number; nullable?: boolean }
	>,
): void {
	const fieldSizeLimitEntries = Object.entries(fieldSizeLimits).map(
		([field, limits]): [
			string,
			{ min?: number; max: number; nullable?: boolean },
		] => {
			if (limits != null && typeof limits === 'object') {
				return [field, limits];
			}
			if (typeof limits === 'number') {
				return [field, { max: limits }];
			}
			throw new Error(`Invalid field size limit for ${field}: ${limits}`);
		},
	);
	const hook: sbvrUtils.Hooks = {
		POSTPARSE: ({ request }) => {
			for (const [field, limits] of fieldSizeLimitEntries) {
				const value = request.values[field];
				if (typeof value !== 'string') {
					continue;
				}
				const { min, max, nullable } = limits;
				if (value.length > max || (min != null && value.length <= min)) {
					const [term, verb = 'has'] = odataNameToSqlName(field)
						.split('-')
						.reverse();
					// hacky way to decide whether to use "a" or "an"
					// should improve one we find cases that this isn't returning the correct results.
					const aOrAn = vowels.includes(term[0]) ? 'an' : 'a';
					const factType = `${verb} ${aOrAn} ${term}`;
					const thatHasFactType = nullable ? `that ${factType}, ` : '';
					const isGreaterThanAnd =
						min != null ? `is greater than ${min} and ` : '';

					throw new BadRequestError(
						`It is necessary that each ${odataNameToSqlName(resource)} ${thatHasFactType}${factType} that has a Length (Type) that ${isGreaterThanAnd}is less than or equal to ${max}.`,
					);
				}
			}
		},
	};

	for (const method of ['POST', 'PATCH', 'PUT'] as const) {
		hooks.addPureHook(method, model, resource, hook);
	}
}
