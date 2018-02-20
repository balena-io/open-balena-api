import * as Promise from 'bluebird';
import * as crypto from 'crypto';
import { sbvrUtils, root, addDeleteHookForDependents } from '../../platform';
import { REGISTRY2_HOST } from '../../lib/config';

sbvrUtils.addPureHook('POST', 'resin', 'image', {
	POSTPARSE: ({ request, api, tx }) => {
		const generateUniqueLocation = (maxAttempts: number): Promise<string> => {
			const candidate =
				REGISTRY2_HOST +
				'/v2/' +
				crypto
					.pseudoRandomBytes(16)
					.toString('hex')
					.toLowerCase();

			return api
				.get({
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
				})
				.then(count => {
					if (count === 0) {
						return candidate;
					}
					if (maxAttempts === 0) {
						throw new Error('Could not generate unique image location');
					}
					return generateUniqueLocation(maxAttempts - 1);
				});
		};

		return generateUniqueLocation(5).then(imageUrl => {
			request.values.is_stored_at__image_location = imageUrl;
		});
	},
});

addDeleteHookForDependents('image', [
	['image_install', 'installs__image'],
	['image__is_part_of__release', 'image'],
	['gateway_download', 'image'],
]);
