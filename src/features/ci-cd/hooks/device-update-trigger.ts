import { hooks, permissions } from '@balena/pinejs';
import { postDevices } from '../../device-proxy/device-proxy';

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTRUN: async (args) => {
		const affectedIds = args.request.affectedIds!;

		// Update devices if they have had their:
		// * app changed
		// * target release changed
		// * device name changed - so a user can restart their service and it will pick up the change
		if (
			(args.request.values.should_be_running__release !== undefined ||
				args.request.values.belongs_to__application != null ||
				args.request.values.device_name != null) &&
			affectedIds.length !== 0
		) {
			await postDevices({
				url: '/v1/update',
				req: permissions.root,
				filter: { id: { $in: affectedIds } },
				// Don't wait for the posts to complete, as they may take a long time
				wait: false,
			});
		}
	},
});
