import {
	addDeleteHookForDependents,
	Dependency,
} from '../../infra/cascade-delete';

export const setupDeleteCascade = <T extends { [key: string]: any }>(
	resource: string,
	dependents: {
		[dependentResource in keyof T]: Dependency<keyof T>;
	},
) => addDeleteHookForDependents('resin', resource, dependents);
