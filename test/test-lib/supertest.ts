import { app } from '../../init.js';
import $supertest from 'supertest';
import type { TokenUserPayload } from '@balena/open-balena-api';
import { errors } from '@balena/open-balena-api';

export type UserObjectParam = Partial<TokenUserPayload> & { token: string };

export const augmentStatusAssertionError = () => {
	// We need to cast this because otherwise the supertest-extension `_assertStatus` method isn't included
	const originalExpect = $supertest.Test.prototype
		.expect as $supertest.Test['expect'];
	/**
	 * This enhances `.expect(statusCode, ...)` to also log the response body when
	 * the statusCode is different than expected, to make the original error more useful.
	 */
	$supertest.Test.prototype.expect = function (this: $supertest.Test, ...args) {
		const [expectedStatus] = args;
		let supertestFluentChain = this;
		if (typeof expectedStatus === 'number') {
			// TODO: Switch `.bind()` to `.call()` once TS is able to pick the correct overload.
			supertestFluentChain = originalExpect.bind(supertestFluentChain)(
				(res) => {
					const error = this._assertStatus(expectedStatus, res);
					if (error) {
						error.message += `, with response body:\n${JSON.stringify(
							res.body,
							null,
							2,
						)}`;
						throw error;
					}
				},
			);
		}
		return originalExpect.apply(supertestFluentChain, args);
	} satisfies typeof originalExpect;
};

export const supertest = function (user?: string | UserObjectParam) {
	// Can be an object with `token`, a JWT string or an API key string
	let token = user;
	if (user != null && typeof user === 'object') {
		if (user.token == null) {
			throw errors.ThisShouldNeverHappenError(
				'Heads-up: You provided an object as a parameter to supertest that does not include a token, making requests that require authentication to always return 401!!!',
			);
		}
		token = user.token;
	}
	// We have to cast `as any` because the types are poorly maintained
	// and don't support setting defaults
	const req = $supertest.agent(app);

	if (typeof token === 'string') {
		req.set('Authorization', `Bearer ${token}`);
	}
	return req;
};
