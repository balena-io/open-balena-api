import * as _ from 'lodash';
import {
	loginUserXHR,
	findUser,
	getUser,
	comparePassword,
} from '../platform/auth';
import { User as DbUser } from '../models';
import { resinApi, root, sbvrUtils } from '../platform';
import { captureException, handleHttpErrors } from '../platform/errors';
import { resetCounter } from '../lib/rate-limiting';
import { RequestHandler } from 'express';
import { SetupOptions } from '..';

const { BadRequestError, NotFoundError } = sbvrUtils;

export const whoami: RequestHandler = async (req, res) => {
	try {
		const user = await getUser(req, true);

		if (user.actor && user.email === undefined) {
			// If we get to this point, then the request is most likely being made
			// using a scoped access token.
			// First we check to see if this token can access the user resource,
			// then if it can, we retrieve user document that corresponds to the
			// `actor` value on the token using root privileges.
			const [userWithId] = (await resinApi.get({
				resource: 'user',
				passthrough: { req },
				options: {
					$filter: {
						actor: user.actor,
					},
					$select: 'id',
					$top: 1,
				},
			})) as Array<{ id: number }>;

			// If the count is 0, then this token doesn't have access to the
			// user resource and we should just continue with whatever was
			// provided from the `getUser` call above.
			if (userWithId) {
				// If we reach this step, then the token has access and we can
				// retrieve the user document in full
				const { id, username, email } = (await resinApi.get({
					resource: 'user',
					passthrough: { req: root },
					id: userWithId.id,
					options: {
						$select: ['id', 'username', 'email'],
					},
				})) as Pick<DbUser, 'id' | 'username' | 'email'>;

				return res.send({
					id,
					username,
					email,
				});
			}
		}

		return res.send({
			id: user.id,
			username: user.username,
			email: user.email,
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error while getting user info', { req });
		res.sendStatus(500);
	}
};

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
		await resetCounter(req);
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
