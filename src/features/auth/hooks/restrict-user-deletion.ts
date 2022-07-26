import { sbvrUtils, hooks, errors } from '@balena/pinejs';

import { getUser } from '../../../infra/auth/auth';
import { checkSudoValidity } from '../../../infra/auth/jwt';

const { BadRequestError, UnauthorizedError } = errors;

hooks.addPureHook('DELETE', 'resin', 'user', {
	POSTPARSE: async ({ request }) => {
		const userIdBind = request.odataQuery?.key;
		if (userIdBind == null) {
			throw new BadRequestError('You must provide user ID');
		}
		if (!('bind' in userIdBind)) {
			throw new BadRequestError('You cannot use a named key for user deletion');
		}

		const userId = sbvrUtils.resolveOdataBind(request.odataBinds, userIdBind);

		// Store the user id in the custom request data for later.
		request.custom.userId = userId;
	},
	PRERUN: async ({ req, request, tx }) => {
		const user = await getUser(req, tx);

		if (user.id !== request.custom.userId) {
			throw new BadRequestError('You can only delete your own account');
		}

		if (!(await checkSudoValidity(user))) {
			throw new UnauthorizedError('Fresh authentication token required');
		}
	},
});
