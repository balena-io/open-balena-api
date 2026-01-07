import { sbvrUtils, hooks, errors } from '@balena/pinejs';
import { findUser } from '../../../infra/auth/auth.js';
import { normalizeHandle } from '../handles.js';
import { USERNAME_BLACKLIST } from '../../../lib/config.js';

const { ConflictError } = errors;

for (const method of ['POST', 'PATCH'] as const) {
	hooks.addPureHook(method, 'resin', 'user', {
		POSTPARSE: ({ request }) => {
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

					let patchedIds: number[] | undefined;
					if (method === 'PATCH') {
						patchedIds = await sbvrUtils.getAffectedIds(args);
						if (patchedIds.length === 0) {
							return;
						}
						if (patchedIds.length > 1) {
							// TODO: This should be handled by a rule for case insensitive uniqueness
							throw new ConflictError(`The ${field} must be unique`);
						}
					}

					const existingUser = await findUser(request.values[field], tx, [
						'id',
					]);
					const isSameUserPatch = existingUser?.id === patchedIds?.[0];
					if (existingUser && !isSameUserPatch) {
						throw new ConflictError(`This ${field} is already taken`);
					}
				}),
			);
		},
	});
}
