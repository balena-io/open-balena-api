import { sbvrUtils, hooks, permissions } from '@balena/pinejs';

hooks.addPureHook('DELETE', 'resin', 'release', {
	PRERUN: async (args) => {
		const releaseIds = await sbvrUtils.getAffectedIds(args);

		if (releaseIds.length === 0) {
			return;
		}

		/**
		 * PATCH all devices which should_be_managed_by__release to disassociate them.
		 */
		await args.api.patch({
			resource: 'device',
			body: {
				should_be_managed_by__release: null,
			},
			options: {
				$filter: {
					should_be_managed_by__release: {
						$in: releaseIds,
					},
				},
			},
			passthrough: {
				req: permissions.root,
			},
		});
	},
});
