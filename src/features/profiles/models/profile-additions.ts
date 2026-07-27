import type { AbstractSqlModel } from '@balena/abstract-sql-compiler';

const APPLICATION_PROFILE_RESOURCE =
	'application-activates-profile name-on-application';

/**
 * `application profile` is a ternary with two `application` roles, and SBVR resolves the bare
 * `application` navigation to the last role (`on-application`). That both collides with the
 * activator `application` column — producing a duplicate `application` property in the generated
 * types — and makes `application/…` filters/expands follow the wrong role. Re-point it at the
 * activator `application` column so it dedupes against the field and navigates the activator.
 */
export const addToModel = (abstractSql: AbstractSqlModel) => {
	const relationships = abstractSql.relationships[
		APPLICATION_PROFILE_RESOURCE
	] as Record<string, { $?: unknown }>;
	if (relationships?.application == null) {
		throw new Error(
			`Could not find the "application" navigation on "${APPLICATION_PROFILE_RESOURCE}"`,
		);
	}
	relationships.application.$ = ['application', ['application', 'id']];
};
