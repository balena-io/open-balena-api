import { hooks, errors } from '@balena/pinejs';
import { findUser } from '../../../infra/auth/auth';
import { normalizeHandle } from '../handles';

const { ConflictError } = errors;

const USERNAME_BLACKLIST = ['root'];

for (const method of ['POST', 'PATCH'] as const) {
	hooks.addPureHook(method, 'resin', 'user', {
		POSTPARSE: async ({ request, tx }) => {
			request.values.username = normalizeHandle(request.values.username);
			if (USERNAME_BLACKLIST.includes(request.values.username)) {
				throw new ConflictError('This username is blacklisted');
			}
			let existingUser = await findUser(request.values.email, tx, ['id']);
			if (existingUser) {
				throw new ConflictError('This email is already taken');
			}

			existingUser = await findUser(request.values.username, tx, ['id']);
			if (existingUser) {
				throw new ConflictError('This username is already taken');
			}
		},
	});
}
