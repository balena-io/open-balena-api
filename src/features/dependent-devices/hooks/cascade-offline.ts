import { hooks } from '@balena/pinejs';

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTRUN: async ({ request, api }) => {
		const affectedIds = request.affectedIds!;

		// We only want to set dependent devices offline when the gateway goes
		// offline, when the gateway comes back it's its job to set the dependent
		// device back to online as need be.
		const isOnline = request.values.is_online;
		if ([false, 0].includes(isOnline) && affectedIds.length !== 0) {
			await api.patch({
				resource: 'device',
				options: {
					$filter: {
						is_managed_by__device: { $in: affectedIds },
						is_online: { $ne: isOnline },
					},
				},
				body: {
					is_online: isOnline,
				},
			});
		}
	},
});
