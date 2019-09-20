import {
	loginUserXHR,
	findUser,
	getUser,
	comparePassword,
	runInvalidPasswordComparison,
} from '../platform/auth';
import { sbvrUtils } from '../platform';
import { captureException, handleHttpErrors } from '../platform/errors';
import { resetCounter } from '../lib/rate-limiting';
import { RequestHandler } from 'express';
import { SetupOptions } from '..';

const { BadRequestError, NotFoundError } = sbvrUtils;

export const whoami: RequestHandler = (req, res) =>
	getUser(req)
		.then(user =>
			res.send({ id: user.id, username: user.username, email: user.email }),
		)
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error while getting user info', { req });
			res.sendStatus(500);
		});

export const login = (onLogin: SetupOptions['onLogin']): RequestHandler => (
	req,
	res,
) => {
	const { username, password } = req.body;

	if (!(username && password)) {
		return res.sendStatus(401);
	}

	return findUser(username)
		.then(user => {
			if (!user) {
				throw new NotFoundError('User not found.');
			}

			const passwordComparison =
				user.password == null
					? runInvalidPasswordComparison()
					: comparePassword(password, user.password);

			return passwordComparison
				.then(matches => {
					if (!matches) {
						throw new BadRequestError('Current password incorrect.');
					}
					if (onLogin) {
						return onLogin(user);
					}
				})
				.then(() => resetCounter(req))
				.then(() => loginUserXHR(res, user.id));
		})
		.catch(BadRequestError, NotFoundError, () => {
			res.sendStatus(401);
		})
		.catch(err => {
			captureException(err, 'Error logging in', { req });
			res.sendStatus(401);
		});
};
