import { hooks, permissions } from '@balena/pinejs';
import { captureException } from '../../../infra/error-handling/index.js';
import { postDevices } from '../../device-proxy/device-proxy.js';

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTRUN: ({ request, tx }) => {
		const affectedIds = request.affectedIds!;

		// Update devices if they have had their:
		// * app changed
		// * target release changed
		// * device name changed - so a user can restart their service and it will pick up the change
		// * target OS release changed, so that Supervisors that support this can trigger a HUP
		if (
			(request.values.is_pinned_on__release !== undefined ||
				request.values.belongs_to__application != null ||
				request.values.device_name != null ||
				request.values.should_be_operated_by__release != null) &&
			affectedIds.length !== 0
		) {
			// Send the update requests only after the tx is committed
			tx.on('end', async () => {
				try {
					await postDevices({
						url: '/v1/update',
						req: permissions.root,
						filter: { id: { $in: affectedIds } },
						wait: false,
					});
				} catch (err) {
					captureException(err, 'Error notifying device updates');
				}
			});
		}
	},
});
