import { fakeTx } from './fixtures.js';
import { expectJwt, getUserFromToken } from './api-helpers.js';
import type { TokenUserPayload } from '../../src/infra/auth/jwt.js';
import { createSessionToken } from '../../src/infra/auth/jwt.js';

/**
 * Issues a JWT that's from 30' in the past, so that it's no longer a sudo JWT
 * (atm defined in oB as SUDO_TOKEN_VALIDITY=20').
 */
export const loginUserSudoTimeoutAgo = async (
	userId: number,
	existingTokenString?: string,
) => {
	const existingToken: Partial<TokenUserPayload> = existingTokenString
		? expectJwt(existingTokenString)
		: {};

	existingToken.authTime = Date.now() - 30 * 60 * 1000;
	const newToken = await createSessionToken(userId, {
		existingToken,
		tx: fakeTx,
	});

	const user = getUserFromToken(newToken);
	return user;
};
