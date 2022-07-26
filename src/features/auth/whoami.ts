import type { RequestHandler } from 'express';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { getUser } from '../../infra/auth/auth';
import { captureException, handleHttpErrors } from '../../infra/error-handling';

import type { User } from '../../balena-model';

const { api } = sbvrUtils;

export const whoami: RequestHandler = async (req, res) => {
	try {
		const userInfo = await sbvrUtils.db.readTransaction(async (tx) => {
			const user = await getUser(req, tx, true);
			if (user.actor && user.email === undefined) {
				// If we get to this point, then the request is most likely being made
				// using a scoped access token.
				// First we check to see if this token can access the user resource,
				// then if it can, we retrieve user document that corresponds to the
				// `actor` value on the token using root privileges.
				const [userWithId] = (await api.resin.get({
					resource: 'user',
					passthrough: { req, tx },
					options: {
						$top: 1,
						$select: 'id',
						$filter: {
							actor: user.actor,
						},
					},
				})) as Array<Pick<User, 'id'>>;

				// If the count is 0, then this token doesn't have access to the
				// user resource and we should just continue with whatever was
				// provided from the `getUser` call above.
				if (userWithId) {
					// If we reach this step, then the token has access and we can
					// retrieve the user document in full
					return (await api.resin.get({
						resource: 'user',
						passthrough: { req: permissions.root, tx },
						id: userWithId.id,
						options: {
							$select: ['id', 'username', 'email'],
						},
					})) as Pick<User, 'id' | 'username' | 'email'>;
				}
			}
			return user;
		});
		res.json({
			id: userInfo.id,
			username: userInfo.username,
			email: userInfo.email,
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error while getting user info', { req });
		res.status(500).end();
	}
};
