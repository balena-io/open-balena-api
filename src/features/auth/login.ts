import type { RequestHandler } from 'express';
import { errors, sbvrUtils } from '@balena/pinejs';
import { comparePassword, findUser } from '../../infra/auth/auth.js';
import { loginUserXHR } from '../../infra/auth/jwt.js';
import { captureException } from '../../infra/error-handling/index.js';
import { permissions } from '@balena/pinejs';

import type { SetupOptions } from '../../index.js';

const { BadRequestError, NotFoundError } = errors;

export const login =
	(onLogin: SetupOptions['onLogin']): RequestHandler =>
	async (req, res) => {
		const { username, password } = req.body;

		if (!(username && password)) {
			return res.status(401).end();
		}

		try {
			await sbvrUtils.db.readTransaction(async (tx) => {
				const user = await findUser(username, tx);
				if (!user) {
					throw new NotFoundError('User not found.');
				}

				const matches = await comparePassword(password, user.password);
				if (!matches) {
					throw new BadRequestError('Current password incorrect.');
				}

				const userPermissions = await permissions.getUserPermissions(user.id);
				if (!userPermissions.includes('auth.credentials_login')) {
					throw new BadRequestError('User not allowed to login.');
				}

				if (onLogin) {
					await onLogin(user, tx, req);
				}
				await req.resetRatelimit?.();
				await loginUserXHR(res, user.id, { tx });
			});
		} catch (err) {
			if (err instanceof BadRequestError || err instanceof NotFoundError) {
				res.status(401).end();
				return;
			}
			captureException(err, 'Error logging in');
			res.status(401).end();
		}
	};
