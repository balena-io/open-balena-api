import { sbvrUtils, hooks, errors } from '@balena/pinejs';
import { findUser } from '../../../infra/auth/auth';
import { normalizeHandle } from '../handles';

const { ConflictError } = errors;

const USERNAME_BLACKLIST = ['root'];

for (const method of ['POST', 'PATCH'] as const) {
	hooks.addPureHook(method, 'resin', 'user', {
		POSTPARSE: async ({ request }) => {
			if (request.values.username != null) {
				request.values.username = normalizeHandle(request.values.username);
				if (USERNAME_BLACKLIST.includes(request.values.username)) {
					throw new ConflictError('This username is blacklisted');
				}
			}
		},
		PRERUN: async (args) => {
			const { request, tx } = args;
			await Promise.all(
				(['username', 'email'] as const).map(async (field) => {
					if (request.values[field] == null) {
						return;
					}
					if (method === 'PATCH') {
						const affectedIds = await sbvrUtils.getAffectedIds(args);
						if (affectedIds.length === 0) {
							return;
						}
						if (affectedIds.length > 1) {
							// TODO: This should be handled by a rule for case insensitive uniqueness
							throw new ConflictError(`The ${field} must be unique`);
						}
					}

					const existingUser = await findUser(request.values[field], tx, [
						'id',
					]);
					if (existingUser) {
						throw new ConflictError(`This ${field} is already taken`);
					}
				}),
			);
		},
	});
}
