import * as Bluebird from 'bluebird';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { getCurrentRequestAffectedIds } from '../../platform';
import { captureException } from '../../platform/errors';

const { api } = sbvrUtils;

const deleteApiKeyHooks: sbvrUtils.Hooks = {
	PRERUN: async (args) => {
		const keyIds = await getCurrentRequestAffectedIds(args);
		if (keyIds.length === 0) {
			return;
		}

		await Bluebird.map(
			['api_key__has__role', 'api_key__has__permission'],
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
		);
	},
};

sbvrUtils.addPureHook('DELETE', 'Auth', 'api_key', deleteApiKeyHooks);
sbvrUtils.addPureHook('DELETE', 'resin', 'api_key', deleteApiKeyHooks);
