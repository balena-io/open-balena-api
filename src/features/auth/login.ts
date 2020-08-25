import type { RequestHandler } from 'express';

import { errors } from '@balena/pinejs';

import { comparePassword, findUser } from '../../infra/auth/auth';
import { loginUserXHR } from '../../infra/auth/jwt';
import { captureException } from '../../infra/error-handling';

import type { SetupOptions } from '../..';

const { BadRequestError, NotFoundError } = errors;

export const login = (
	onLogin: SetupOptions['onLogin'],
): RequestHandler => async (req, res) => {
	const { username, password } = req.body;

	if (!(username && password)) {
		return res.sendStatus(401);
	}

	try {
		const user = await findUser(username);
		if (!user) {
			throw new NotFoundError('User not found.');
		}

		const matches = await comparePassword(password, user.password);
		if (!matches) {
			throw new BadRequestError('Current password incorrect.');
		}
		if (onLogin) {
			await onLogin(user);
		}
		await req.resetRatelimit?.();
		await loginUserXHR(res, user.id);
	} catch (err) {
		if (err instanceof BadRequestError || err instanceof NotFoundError) {
			res.sendStatus(401);
			return;
		}
		captureException(err, 'Error logging in', { req });
		res.sendStatus(401);
	}
};
