import * as _ from 'lodash';
import * as Bluebird from 'bluebird';

import { assignUserRole } from '../../platform/permissions';
import { captureException } from '../../platform/errors';

import { sbvrUtils } from '@resin/pinejs';
import { createActor } from '../../platform';
import { getUser } from '../../platform/auth';

const { root, api, BadRequestError, InternalRequestError } = sbvrUtils;

sbvrUtils.addPureHook('POST', 'resin', 'user', {
	POSTPARSE: createActor,

	POSTRUN: async ({ result, tx }) => {
		const [role] = (await api.Auth.get({
			resource: 'role',
			passthrough: {
				tx,
				req: root,
			},
			options: {
				$select: 'id',
				$filter: {
					name: 'default-user',
				},
			},
		})) as AnyObject[];
		if (role == null) {
			throw new InternalRequestError('Unable to find the default user role');
		}
		return assignUserRole(result, role.id, tx);
	},
});

sbvrUtils.addPureHook('DELETE', 'resin', 'user', {
	POSTPARSE: async ({ req, request }) => {
		let userId = request.odataQuery?.key;
		if (userId == null) {
			throw new BadRequestError('You must provide user ID');
		}

		const user = await getUser(req);
		userId = sbvrUtils.resolveOdataBind(request.odataBinds, userId);

		if (user.id !== userId) {
			throw new BadRequestError('You can only delete your own account');
		}

		// Store the user id in the custom request data for later.
		request.custom.userId = userId;
	},
	PRERUN: ({ req, request, tx, api }) => {
		const { userId } = request.custom;

		const authApiTx = sbvrUtils.api.Auth.clone({
			passthrough: {
				tx,
				req: root,
			},
		});

		const authApiDeletes = Bluebird.map(
			['user__has__role', 'user__has__permission'],
			resource =>
				authApiTx
					.delete({
						resource,
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

		return Bluebird.all([authApiDeletes, apiKeyDelete]);
	},
});
