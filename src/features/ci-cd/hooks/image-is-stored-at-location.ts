import { hooks, permissions, errors } from '@balena/pinejs';

import { REGISTRY2_HOST } from '../../../lib/config.js';
import { randomBytesAsync } from '../../../lib/utils.js';

const { InternalRequestError } = errors;

hooks.addPureHook('POST', 'resin', 'image', {
	POSTPARSE: async ({ request, api, tx }) => {
		const maxAttempts = 5;
		for (let i = 0; i < maxAttempts; i++) {
			const candidate =
				REGISTRY2_HOST +
				'/v2/' +
				(await randomBytesAsync(16)).toString('hex').toLowerCase();

			const count = await api.get({
				resource: 'image',
				passthrough: {
					tx,
					req: permissions.root,
				},
				options: {
					$count: {
						$filter: {
							is_stored_at__image_location: candidate,
						},
					},
				},
			});
			if (count === 0) {
				request.values.is_stored_at__image_location = candidate;
				return;
			}
		}

		throw new InternalRequestError('Could not generate unique image location');
	},
});
