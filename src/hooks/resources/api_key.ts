import { sbvrUtils, hooks, permissions } from '@balena/pinejs';

import { captureException } from '../../infra/error-handling';

const { api, getAffectedIds } = sbvrUtils;

const deleteApiKeyHooks: hooks.Hooks = {
	PRERUN: async (args) => {
		const keyIds = await getAffectedIds(args);
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

hooks.addPureHook('DELETE', 'Auth', 'api_key', deleteApiKeyHooks);
hooks.addPureHook('DELETE', 'resin', 'api_key', deleteApiKeyHooks);
