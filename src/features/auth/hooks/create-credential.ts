import { hooks, errors } from '@balena/pinejs';

import { createCredential } from '../../../infra/auth/create-credential.ts';

// Every user and api key gets its own credential, which is never reused or changed
for (const resource of ['user', 'api_key']) {
	hooks.addPureHook('POST', 'resin', resource, {
		POSTPARSE: createCredential,
	});
	for (const method of ['PATCH', 'PUT'] as const) {
		hooks.addPureHook(method, 'resin', resource, {
			POSTPARSE: ({ request }) => {
				if (request.values.credential !== undefined) {
					throw new errors.BadRequestError('The credential cannot be changed');
				}
			},
		});
	}
}
