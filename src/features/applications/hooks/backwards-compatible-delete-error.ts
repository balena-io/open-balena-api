import { sbvrUtils, hooks, errors } from '@balena/pinejs';

hooks.addPureHook('DELETE', 'resin', 'application', {
	PRERUN: async (args) => {
		const appIds = await sbvrUtils.getAffectedIds(args);
		if (appIds.length === 0) {
			const { odataQuery } = args.request;
			if (odataQuery != null && odataQuery.key != null) {
				// If there's a specific app targeted we make sure we give a 404 for backwards compatibility
				throw new errors.NotFoundError('Application(s) not found.');
			}
			return;
		}
	},
});
