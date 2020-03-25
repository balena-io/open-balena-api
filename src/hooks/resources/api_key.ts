import { sbvrUtils } from '@resin/pinejs';
import { getCurrentRequestAffectedIds } from '../../platform';

import * as Bluebird from 'bluebird';
import { captureException } from '../../platform/errors';

const { root, api } = sbvrUtils;

const deleteApiKeyHooks: sbvrUtils.Hooks = {
	PRERUN: async (args) => {
		const keyIds = await getCurrentRequestAffectedIds(args);
		if (keyIds.length === 0) {
			return;
		}

		await Bluebird.map(
			['api_key__has__role', 'api_key__has__permission'],
			(resource) =>
				api.Auth.delete({
					resource,
					passthrough: {
						tx: args.tx,
						req: root,
					},
					options: {
						$filter: { api_key: { $in: keyIds } },
					},
				}).tapCatch((err) => {
					captureException(err, 'Error deleting api key ' + resource, {
						req: args.req,
					});
				}),
		);
	},
};

sbvrUtils.addPureHook('DELETE', 'Auth', 'api_key', deleteApiKeyHooks);
sbvrUtils.addPureHook('DELETE', 'resin', 'api_key', deleteApiKeyHooks);
