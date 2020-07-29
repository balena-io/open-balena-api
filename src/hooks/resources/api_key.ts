import { sbvrUtils, permissions } from '@balena/pinejs';

import { captureException } from '../../platform/errors';

const { api } = sbvrUtils;

const deleteApiKeyHooks: sbvrUtils.Hooks = {
	PRERUN: async (args) => {
		const keyIds = await sbvrUtils.getAffectedIds(args);
		if (keyIds.length === 0) {
			return;
		}

		await Promise.all(
			['api_key__has__role', 'api_key__has__permission'].map(
				async (resource) => {
					try {
						await api.Auth.delete({
							resource,
							passthrough: {
								tx: args.tx,
								req: permissions.root,
							},
							options: {
								$filter: { api_key: { $in: keyIds } },
							},
						});
					} catch (err) {
						captureException(err, 'Error deleting api key ' + resource, {
							req: args.req,
						});
						throw err;
					}
				},
			),
		);
	},
};

sbvrUtils.addPureHook('DELETE', 'Auth', 'api_key', deleteApiKeyHooks);
sbvrUtils.addPureHook('DELETE', 'resin', 'api_key', deleteApiKeyHooks);
