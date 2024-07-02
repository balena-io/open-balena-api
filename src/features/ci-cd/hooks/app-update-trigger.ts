import { hooks, permissions } from '@balena/pinejs';
import { captureException } from '../../../infra/error-handling/index.js';
import { postDevices } from '../../device-proxy/device-proxy.js';

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: ({ request, tx }) => {
		const affectedIds = request.affectedIds!;
		if (
			request.values.should_be_running__release != null &&
			affectedIds.length !== 0
		) {
			// Send the update requests only after the tx is committed
			tx.on('end', async () => {
				try {
					// Only update apps if they have had their release changed.
					await postDevices({
						url: '/v1/update',
						req: permissions.root,
						filter: {
							belongs_to__application: { $in: affectedIds },
							is_running__release: {
								$ne: request.values.should_be_running__release,
							},
							is_pinned_on__release: null,
						},
						wait: false,
					});
				} catch (err) {
					captureException(err, 'Error notifying device updates');
				}
			});
		}
	},
});
