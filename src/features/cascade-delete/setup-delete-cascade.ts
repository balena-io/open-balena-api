import { addDeleteHookForDependents } from '../../infra/cascade-delete';

export const setupDeleteCascade = (
	resource: string,
	dependents: Array<[string, string]>,
) => addDeleteHookForDependents('resin', resource, dependents);
