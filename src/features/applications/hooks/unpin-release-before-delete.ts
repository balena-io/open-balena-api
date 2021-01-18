import { sbvrUtils, hooks } from '@balena/pinejs';

hooks.addPureHook('DELETE', 'resin', 'application', {
	PRERUN: async (args) => {
		const appIds = await sbvrUtils.getAffectedIds(args);
		if (appIds.length === 0) {
			return;
		}
		// We need to null `should_be_running__release` or otherwise we have a circular dependency and cannot delete either
		await args.api.patch({
			resource: 'application',
			options: {
				$filter: {
					id: { $in: appIds },
					should_be_running__release: { $ne: null },
				},
			},
			body: { should_be_running__release: null },
		});
	},
});
