import { hooks, permissions } from '@balena/pinejs';
import { postDevices } from '../../device-proxy/device-proxy';

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: async ({ request }) => {
		const affectedIds = request.affectedIds!;
		if (
			request.values.should_be_running__release != null &&
			affectedIds.length !== 0
		) {
			// Only update apps if they have had their release changed.
			await postDevices({
				url: '/v1/update',
				req: permissions.root,
				filter: {
					device_application: {
						$any: {
							$alias: 'da',
							$expr: {
								da: {
									belongs_to__application: { $in: affectedIds },
								},
							},
						},
					},
					is_running__release: {
						$ne: request.values.should_be_running__release,
					},
					should_be_running__release: null,
				},
				// Don't wait for the posts to complete, as they may take a long time and we've already sent the prompt to update.
				wait: false,
			});
		}
	},
});
