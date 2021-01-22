import { addDeleteHookForDependents } from '../../infra/cascade-delete';

export const setupDeleteCascade = (
	resource: string,
	dependents: Parameters<typeof addDeleteHookForDependents>[2],
) => addDeleteHookForDependents('resin', resource, dependents);
