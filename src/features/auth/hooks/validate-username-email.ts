import { hooks, errors } from '@balena/pinejs';
import { findUser } from '../../../infra/auth/auth';

const { ConflictError } = errors;

const USERNAME_BLACKLIST = ['root'];

hooks.addPureHook('POST', 'resin', 'user', {
	POSTPARSE: async ({ request, tx }) => {
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
