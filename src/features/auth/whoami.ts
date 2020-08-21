import type { RequestHandler } from 'express';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { getUser } from '../../platform/auth';
import { captureException, handleHttpErrors } from '../../platform/errors';

import type { User as DbUser } from '../../models';

const { api } = sbvrUtils;

export const whoami: RequestHandler = async (req, res) => {
	try {
		const user = await getUser(req, true);

		if (user.actor && user.email === undefined) {
			// If we get to this point, then the request is most likely being made
			// using a scoped access token.
			// First we check to see if this token can access the user resource,
			// then if it can, we retrieve user document that corresponds to the
			// `actor` value on the token using root privileges.
			const [userWithId] = (await api.resin.get({
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
				const { id, username, email } = (await api.resin.get({
					resource: 'user',
					passthrough: { req: permissions.root },
					id: userWithId.id,
					options: {
						$select: ['id', 'username', 'email'],
					},
				})) as Pick<DbUser, 'id' | 'username' | 'email'>;

				return res.json({
					id,
					username,
					email,
				});
			}
		}

		return res.json({
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
