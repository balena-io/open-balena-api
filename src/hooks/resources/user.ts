import { sbvrUtils, hooks, permissions, errors } from '@balena/pinejs';

import { createActor } from '../../infra/auth/create-actor';
import { getUser } from '../../infra/auth/auth';
import { checkSudoValidity, generateNewJwtSecret } from '../../infra/auth/jwt';
import { assignUserRole } from '../../infra/auth/permissions';
import { UnauthorizedError } from '@balena/pinejs/out/sbvr-api/errors';

const { BadRequestError, InternalRequestError } = errors;
const { api } = sbvrUtils;

hooks.addPureHook('POST', 'resin', 'user', {
	POSTPARSE: createActor,

	POSTRUN: async ({ result, tx }) => {
		const role = await api.Auth.get({
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
		});
		if (role == null) {
			throw new InternalRequestError('Unable to find the default user role');
		}
		await assignUserRole(result, role.id, tx);
	},
});

hooks.addPureHook('POST', 'resin', 'user', {
	/**
	 * Default the jwt secret on signup
	 */
	async POSTPARSE({ request }) {
		request.values.jwt_secret = await generateNewJwtSecret();
	},
});

hooks.addPureHook('PATCH', 'resin', 'user', {
	/**
	 * Logout existing sessions on field changes
	 */
	async POSTPARSE({ request }) {
		if (
			request.values.password !== undefined ||
			request.values.username !== undefined
		) {
			request.values.jwt_secret = await generateNewJwtSecret();
		}
	},
});

hooks.addPureHook('DELETE', 'resin', 'user', {
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

		if (!(await checkSudoValidity(user))) {
			throw new UnauthorizedError('Fresh authentication token required');
		}

		// Store the user id in the custom request data for later.
		request.custom.userId = userId;
	},
});
