import { sbvrUtils, hooks } from '@balena/pinejs';
import { captureException } from '../error-handling';
import type { Filter } from 'pinejs-client-core';

type DependencyReference<T> = {
	dependsOn: T | T[];
	field: string | string[];
};
export type Dependency<T> = string | string[] | DependencyReference<T>;

const deferred = () => {
	let resolve: (value: PromiseLike<void>) => void;
	const promise = new Promise<void>(($resolve) => {
		resolve = $resolve;
	});
	return {
		promise,
		// @ts-expect-error This complains about it not being assigned yet but it is guaranteed to be
		resolve,
	};
};

export function addDeleteHookForDependents<T extends { [key: string]: any }>(
	model: string,
	resource: string,
	dependents: {
		[dependentResource in keyof T]: Dependency<keyof T>;
	},
) {
	const dependentResources = Object.keys(dependents) as Array<
		keyof typeof dependents
	>;

	hooks.addPureHook('DELETE', model, resource, {
		PRERUN: async (args) => {
			const { api, req } = args;

			const resourceIds = await sbvrUtils.getAffectedIds(args);
			if (resourceIds.length === 0) {
				return;
			}

			const buildFilter = (dep: Dependency<keyof T>): Filter => {
				return Array.isArray(dep)
					? dep.map((f) => ({ [f]: { $in: resourceIds } }))
					: typeof dep === 'object'
					? buildFilter(dep.field)
					: { [dep]: { $in: resourceIds } };
			};

			const tryDelete = async (
				dependentResource: keyof T,
				dep: Dependency<keyof T>,
			) => {
				try {
					await api.delete({
						resource: dependentResource as string,
						options: {
							$filter: buildFilter(dep),
						},
					});
				} catch (err) {
					captureException(
						err,
						`Error deleting resource '${dependentResource}' before deleting '${resource}' `,
						{
							req,
						},
					);
					throw err;
				}
			};

			const awaitDeps = async (d: Dependency<keyof T>) => {
				if (Array.isArray(d)) {
					for (const dep of d) {
						await awaitDeps(dep);
					}
				} else if (typeof d === 'object') {
					if (Array.isArray(d.dependsOn)) {
						for (const dependsOn of d.dependsOn) {
							await results[dependsOn]!.promise;
						}
					} else {
						await results[d.dependsOn]!.promise;
					}
				}
			};

			const results: {
				[dependentResource in keyof T]?: ReturnType<typeof deferred>;
			} = {};
			for (const dependentResource of dependentResources) {
				results[dependentResource] = deferred();
			}
			for (const dependentResource of dependentResources) {
				const dep = dependents[dependentResource] as Dependency<keyof T>;
				results[dependentResource]!.resolve(
					(async () => {
						await awaitDeps(dep);
						await tryDelete(dependentResource, dep);
					})(),
				);
			}
			await Promise.all(
				dependentResources.map(
					(dependentResource) => results[dependentResource]!.promise,
				),
			);
		},
	});
}
