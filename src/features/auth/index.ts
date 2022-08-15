import type { Application } from 'express';
import type { SetupOptions } from '../..';

import { SECONDS_PER_HOUR } from '@balena/env-parsing';
import {
	createRateLimiter,
	createRateLimitMiddleware,
} from '../../infra/rate-limiting';
import {
	apiKeyMiddleware,
	authorizedMiddleware,
	authenticatedMiddleware,
	permissionRequiredMiddleware,
} from '../../infra/auth';
import { login } from './login';
import { getUserPublicKeys } from './public-keys';
import { refreshToken } from './refresh-token';
import { whoami } from './whoami';

export * from './handles';
export { refreshToken };

// Rate limit for unauthenticated access
export const loginRateLimiter = createRateLimitMiddleware(
	createRateLimiter('login', {
		points: 10, // 10 tries
		blockDuration: 1 * SECONDS_PER_HOUR, // wait 1 hour after 10 tries (in seconds)
		duration: 2 * SECONDS_PER_HOUR, // reset counter after 2 hours (in seconds)
	}),
);

export const setup = (app: Application, onLogin: SetupOptions['onLogin']) => {
	app.post('/login_', loginRateLimiter('body.username'), login(onLogin));

	app.get('/user/v1/whoami', authorizedMiddleware, whoami);

	app.get(
		'/auth/v1/public-keys/:username',
		apiKeyMiddleware,
		getUserPublicKeys,
	);

	app.get(
		'/user/v1/refresh-token',
		authenticatedMiddleware,
		permissionRequiredMiddleware('auth.create_token'),
		refreshToken,
	);
	app.post(
		'/user/v1/refresh-token',
		authenticatedMiddleware,
		permissionRequiredMiddleware('auth.create_token'),
		refreshToken,
	);
};
