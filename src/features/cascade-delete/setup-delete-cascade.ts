import { addCascadeDeleteHook } from '../../infra/cascade-delete/index.ts';

export const addDeleteHookForDependents = (
	resource: string,
	dependents: Parameters<typeof addCascadeDeleteHook>[2],
) => {
	addCascadeDeleteHook('resin', resource, dependents);
};
