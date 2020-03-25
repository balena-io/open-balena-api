import { sbvrUtils } from '@resin/pinejs';

import { addDeleteHookForDependents } from '../../platform';

import { REGISTRY2_HOST } from '../../lib/config';
import { pseudoRandomBytesAsync } from '../../lib/utils';

const { InternalRequestError, root } = sbvrUtils;

sbvrUtils.addPureHook('POST', 'resin', 'image', {
	POSTPARSE: async ({ request, api, tx }) => {
		const maxAttempts = 5;
		for (let i = 0; i < maxAttempts; i++) {
			const candidate =
				REGISTRY2_HOST +
				'/v2/' +
				(await pseudoRandomBytesAsync(16)).toString('hex').toLowerCase();

			const count = await api.get({
				resource: 'image/$count',
				passthrough: {
					tx,
					req: root,
				},
				options: {
					$filter: {
						is_stored_at__image_location: candidate,
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

addDeleteHookForDependents('image', [
	['image_install', 'installs__image'],
	['image__is_part_of__release', 'image'],
	['gateway_download', 'image'],
]);
