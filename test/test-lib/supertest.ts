import { app } from '../../init';
import $supertest from 'supertest';
import { User } from '../../src/infra/auth/jwt-passport';
import { ThisShouldNeverHappenError } from '../../src/infra/error-handling';

export type UserObjectParam = Partial<User> & { token: string };

export const augmentStatusAssertionError = () => {
	const originalExpect: $supertest.Test['expect'] =
		$supertest.Test.prototype.expect;
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
			throw ThisShouldNeverHappenError(
				'Heads-up: You provided an object as a parameter to supertest that does not include a token, making requests that require authentication to always return 401!!!',
			);
		}
		token = user.token;
	}
	// We have to cast `as any` because the types are poorly maintained
	// and don't support setting defaults
	const req: any = $supertest.agent(app);

	if (typeof token === 'string') {
		req.set('Authorization', `Bearer ${token}`);
	}
	return req as ReturnType<typeof $supertest.agent>;
};
