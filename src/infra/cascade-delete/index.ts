import { sbvrUtils, hooks } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';
import { captureException } from '../error-handling/index.ts';

export function addDeleteHookForDependents(
	model: string,
	resource: string,
	dependents: {
		[dependentResource: string]:
			string | string[] | ((resourceIds: number[]) => Filter);
	},
): void {
	const dependentResources = Object.keys(dependents);

	hooks.addPureHook('DELETE', model, resource, {
		PRERUN: async (args) => {
			const { api } = args;

			const resourceIds = await sbvrUtils.getAffectedIds(args);
			if (resourceIds.length === 0) {
				return;
			}

			for (const dependentResource of dependentResources) {
				const resourceIdField = dependents[dependentResource];
				try {
					const filter =
						typeof resourceIdField === 'function'
							? resourceIdField(resourceIds)
							: Array.isArray(resourceIdField)
								? resourceIdField.map((f) => ({ [f]: { $in: resourceIds } }))
								: { [resourceIdField]: { $in: resourceIds } };
					await api.delete({
						resource: dependentResource,
						options: {
							$filter: filter,
						},
					});
				} catch (err) {
					captureException(
						err,
						`Error deleting resource '${dependentResource}' before deleting '${resource}'`,
					);
					throw err;
				}
			}
		},
	});
}
