import { hooks, permissions } from '@balena/pinejs';
import { postDevices } from '../../device-proxy/device-proxy';

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTRUN: async (args) => {
		const affectedIds = args.request.affectedIds!;

		// Update devices if they have had their device name changed - so a user can restart their service and it will pick up the change
		if (args.request.values.device_name != null && affectedIds.length !== 0) {
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

hooks.addPureHook('POST', 'resin', 'device_application', {
	/**
	 * Notify device to update if they've had an app added
	 * TODO-MULTI-APP: Deleting apps is also covered by this in single-multi-app world but needs to be handled in true multi-app
	 */
	POSTRUN: async ({ request, result }) => {
		if (result == null) {
			return;
		}

		await postDevices({
			url: '/v1/update',
			req: permissions.root,
			filter: { id: request.values.device },
			// Don't wait for the post to complete, as it may take a long time
			wait: false,
		});
	},
});

hooks.addPureHook('PATCH', 'resin', 'device_application', {
	POSTRUN: async (args) => {
		const affectedIds = args.request.affectedIds!;
		if (
			affectedIds.length === 0 ||
			args.request.values.should_be_running__release === undefined
		) {
			return;
		}

		const deviceApps = (await args.api.get({
			resource: 'device_application',
			options: {
				$select: 'device',
				$filter: {
					id: {
						$in: affectedIds,
					},
				},
			},
		})) as Array<{ device: { __id: number } }>;

		if (deviceApps.length === 0) {
			return;
		}

		const deviceIds = deviceApps.map(({ device }) => device.__id);

		// Update devices if they have had their target release changed
		await postDevices({
			url: '/v1/update',
			req: permissions.root,
			filter: { id: { $in: deviceIds } },
			// Don't wait for the posts to complete, as they may take a long time
			wait: false,
		});
	},
});
