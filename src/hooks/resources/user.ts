import * as Bluebird from 'bluebird';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import { createActor } from '../../platform';
import { getUser } from '../../platform/auth';
import { captureException } from '../../platform/errors';
import { assignUserRole } from '../../platform/permissions';

const { BadRequestError, InternalRequestError } = errors;
const { api } = sbvrUtils;

sbvrUtils.addPureHook('POST', 'resin', 'user', {
	POSTPARSE: createActor,

	POSTRUN: async ({ result, tx }) => {
		const role = (await api.Auth.get({
			resource: 'role',
			passthrough: {
				tx,
				req: permissions.root,
			},
			id: {
				name: 'default-user',
			},
			options: {
				$select: 'id',
			},
		})) as AnyObject;
		if (role == null) {
			throw new InternalRequestError('Unable to find the default user role');
		}
		return assignUserRole(result, role.id, tx);
	},
});

sbvrUtils.addPureHook('DELETE', 'resin', 'user', {
	POSTPARSE: async ({ req, request }) => {
		const userIdBind = request.odataQuery?.key;
		if (userIdBind == null) {
			throw new BadRequestError('You must provide user ID');
		}
		if (!('bind' in userIdBind)) {
			throw new BadRequestError('You cannot use a named key for user deletion');
		}

		const userId = sbvrUtils.resolveOdataBind(request.odataBinds, userIdBind);
		const user = await getUser(req);

		if (user.id !== userId) {
			throw new BadRequestError('You can only delete your own account');
		}

		// Store the user id in the custom request data for later.
		request.custom.userId = userId;
	},
	PRERUN: ({ req, request, tx, api: resinApi }) => {
		const { userId } = request.custom;

		const authApiTx = sbvrUtils.api.Auth.clone({
			passthrough: {
				tx,
				req: permissions.root,
			},
		});

		const authApiDeletes = Bluebird.map(
			['user__has__role', 'user__has__permission'],
			async (resource) => {
				try {
					await authApiTx.delete({
						resource,
						options: {
							$filter: {
								user: userId,
							},
						},
					});
				} catch (err) {
					captureException(err, `Error deleting user ${resource}`, { req });
					throw err;
				}
			},
		);

		const apiKeyDelete = resinApi
			.get({
				resource: 'user',
				id: userId,
				options: {
					$select: 'actor',
				},
			})
			.then(async (user: AnyObject) => {
				request.custom.actorId = user.actor;
				try {
					await authApiTx.delete({
						resource: 'api_key',
						options: {
							$filter: {
								is_of__actor: user.actor,
							},
						},
					});
				} catch (err) {
					captureException(err, 'Error deleting user api_key', { req });
					throw err;
				}
			});

		return Promise.all([authApiDeletes, apiKeyDelete]);
	},
});
