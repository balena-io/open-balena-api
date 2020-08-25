import { sbvrUtils, hooks } from '@balena/pinejs';
import { captureException } from '../error-handling';

export function addDeleteHookForDependents(
	resource: string,
	dependents: Array<[string, string]>,
) {
	hooks.addPureHook('DELETE', 'resin', resource, {
		PRERUN: async (args) => {
			const { api, req } = args;

			const resourceIds = await sbvrUtils.getAffectedIds(args);
			if (resourceIds.length === 0) {
				return;
			}

			for (const [dependent, resourceIdField] of dependents) {
				try {
					await api.delete({
						resource: dependent,
						options: {
							$filter: {
								[resourceIdField]: { $in: resourceIds },
							},
						},
					});
				} catch (err) {
					captureException(
						err,
						`Error deleting resource '${dependent}' before deleting '${resource}' `,
						{
							req,
						},
					);
					throw err;
				}
			}
		},
	});
}
