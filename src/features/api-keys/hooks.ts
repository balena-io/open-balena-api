import { hooks, permissions, sbvrUtils } from '@balena/pinejs';
import { captureException } from '../../infra/error-handling/index.ts';

const { api, getAffectedIds } = sbvrUtils;

// The actor row outlives the resource, so expire its api keys explicitly to
// stop them from authenticating once the resource they belong to is gone.
// Users are not included since their api keys are deleted along with them.
const addExpireActorApiKeysOnDeleteHook = (
	resource: 'application' | 'device',
) => {
	hooks.addPureHook('DELETE', 'resin', resource, {
		PRERUN: async (args) => {
			const ids = await getAffectedIds(args);
			if (ids.length === 0) {
				return;
			}
			try {
				const actorables = await api.resin.get({
					resource,
					passthrough: { tx: args.tx, req: permissions.rootRead },
					options: {
						$select: 'actor',
						$filter: { id: { $in: ids } },
					},
				});
				if (actorables.length === 0) {
					return;
				}
				await api.Auth.patch({
					resource: 'api_key',
					passthrough: { tx: args.tx, req: permissions.root },
					options: {
						$filter: {
							is_of__actor: { $in: actorables.map((a) => a.actor.__id) },
							$or: [
								{ expiry_date: null },
								{ expiry_date: { $gt: { $now: {} } } },
							],
						},
					},
					body: { expiry_date: new Date() },
				});
			} catch (err) {
				captureException(err, `Error expiring the api keys of ${resource}`);
				throw err;
			}
		},
	});
};

addExpireActorApiKeysOnDeleteHook('application');
addExpireActorApiKeysOnDeleteHook('device');
