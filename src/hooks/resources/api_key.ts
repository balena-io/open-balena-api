import {
	sbvrUtils,
	authApi,
	root,
	getCurrentRequestAffectedIds,
} from '../../platform';

import { captureException } from '../../platform/errors';
import * as Promise from 'bluebird';

const deleteApiKeyHooks: sbvrUtils.Hooks = {
	PRERUN: args =>
		getCurrentRequestAffectedIds(args).then(keyIds => {
			if (keyIds.length === 0) {
				return;
			}

			return Promise.map(
				['api_key__has__role', 'api_key__has__permission'],
				resource =>
					authApi
						.delete({
							resource,
							passthrough: {
								tx: args.tx,
								req: root,
							},
							options: {
								$filter: { api_key: { $in: keyIds } },
							},
						})
						.tapCatch(err => {
							captureException(err, 'Error deleting api key ' + resource, {
								req: args.req,
							});
						}),
			).return();
		}),
};

sbvrUtils.addPureHook('DELETE', 'Auth', 'api_key', deleteApiKeyHooks);
sbvrUtils.addPureHook('DELETE', 'resin', 'api_key', deleteApiKeyHooks);
