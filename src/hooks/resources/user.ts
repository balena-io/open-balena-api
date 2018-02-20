import * as _ from 'lodash';
import * as Promise from 'bluebird';

import { assignUserRole } from '../../platform/permissions';
import { captureException } from '../../platform/errors';

import { sbvrUtils, authApi, root, createActor } from '../../platform';
import { getUser } from '../../platform/auth';

sbvrUtils.addPureHook('POST', 'resin', 'user', {
	POSTPARSE: createActor,

	POSTRUN: ({ result, tx }) =>
		authApi
			.get({
				resource: 'role',
				passthrough: {
					tx,
					req: root,
				},
				options: {
					$filter: {
						name: 'default-user',
					},
				},
			})
			.then(([role]: AnyObject[]) => {
				if (role == null) {
					throw new Error('Unable to find the default user role');
				}
				return assignUserRole(result, role.id, tx);
			}),
});

sbvrUtils.addPureHook('DELETE', 'resin', 'user', {
	POSTPARSE: ({ req, request }) => {
		let userId = _.get(request.odataQuery, 'key');
		if (userId == null) {
			throw new Error('You must provide user ID');
		}

		return getUser(req).then(user => {
			userId = sbvrUtils.resolveOdataBind(request.odataBinds, userId);

			if (user.id !== userId) {
				throw new Error('You can only delete your own account');
			}

			// Store the user id in the custom request data for later.
			request.custom.userId = userId;
		});
	},
	PRERUN: ({ req, request, tx, api }) => {
		const { userId } = request.custom;

		const authApiTx = authApi.clone({
			passthrough: {
				tx,
				req: root,
			},
		});

		const authApiDeletes = Promise.map(
			['user__has__role', 'user__has__permission'],
			resource =>
				authApiTx
					.delete({
						resource: resource,
						options: {
							$filter: {
								user: userId,
							},
						},
					})
					.tapCatch(err => {
						captureException(err, `Error deleting user ${resource}`, { req });
					}),
		);

		const apiKeyDelete = api
			.get({
				resource: 'user',
				id: userId,
				options: {
					$select: 'actor',
				},
			})
			.then((user: AnyObject) => {
				request.custom.actorId = user.actor;
				return authApiTx
					.delete({
						resource: 'api_key',
						options: {
							$filter: {
								is_of__actor: user.actor,
							},
						},
					})
					.tapCatch(err => {
						captureException(err, 'Error deleting user api_key', { req });
					});
			});

		return Promise.all([authApiDeletes, apiKeyDelete]);
	},
});
