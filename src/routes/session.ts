import {
	loginUserXHR,
	findUser,
	getUser,
	comparePassword,
} from '../platform/auth';
import { sbvrUtils, resinApi, root } from '../platform';
import { captureException, handleHttpErrors } from '../platform/errors';
import { resetCounter } from '../lib/rate-limiting';
import { RequestHandler } from 'express';

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

export const login: RequestHandler = (req, res) => {
	const { username, password } = req.body;

	if (!(username && password)) {
		return res.sendStatus(401);
	}

	return findUser(username)
		.then(user => {
			if (!user) {
				throw new NotFoundError('User not found.');
			}

			return comparePassword(password, user.password)
				.then(res => {
					if (!res) {
						throw new BadRequestError('Current password incorrect.');
					}
					return resinApi.patch({
						resource: 'user',
						id: user.id,
						passthrough: { req: root },
						body: {
							// FIXME: we need `id` set below because otherwise the request
							// will fail because body will be empty as the password related
							// fields are filtered out because they're not defined on the
							// open source model.
							id: user.id,
							password_reset_code: null,
							can_reset_password_until__expiry_date: null,
						},
					});
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
