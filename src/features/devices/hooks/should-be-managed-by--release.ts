import { hooks } from '@balena/pinejs';
import { getAffectedIds } from '@balena/pinejs/out/sbvr-api/sbvr-utils';

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { request } = args;
		const deviceIds = await getAffectedIds(args);

		if (
			request.values.should_be_managed_by__release != null ||
			deviceIds.length === 0
		) {
			return;
		}

		await args.api.get({
			resource: 'device',
			options: {
				$select: ['supervisor_version'],
				$filter: {
					id: {
						$in: deviceIds,
					},
					should_be_managed_by__release: null,
				},
			},
		});

		/**
		 * These device(s) should have a valid release assigned based on their current
		 * running supervisor version, if we have one...
		 */
	},
});
