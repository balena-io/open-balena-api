import { hooks } from '@balena/pinejs';
import { validateHandle } from '../../auth/index.js';

for (const method of ['POST', 'PATCH'] as const) {
	hooks.addPureHook(method, 'resin', 'organization', {
		POSTPARSE: async ({ request }) => {
			if (request.values.handle) {
				validateHandle(request.values.handle);
			}
		},
	});
}
