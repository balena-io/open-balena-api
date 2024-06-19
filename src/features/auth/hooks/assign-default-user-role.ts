import { sbvrUtils, hooks, permissions, errors } from '@balena/pinejs';

import { getRegistrationRole } from '../../../infra/auth/auth.js';
import { assignUserRole } from '../../../infra/auth/permissions.js';

const { InternalRequestError } = errors;
const { api } = sbvrUtils;

hooks.addPureHook('POST', 'resin', 'user', {
	POSTRUN: async ({ request, result, tx }) => {
		if (typeof result !== 'number') {
			throw new InternalRequestError('Unable to find created user id');
		}
		const role = await api.Auth.get({
			resource: 'role',
			passthrough: {
				tx,
				req: permissions.root,
			},
			id: {
				name: getRegistrationRole(request.values),
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
