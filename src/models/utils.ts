import * as _ from 'lodash';

export interface WithId {
	id: number;
}

export interface PineResourceBase extends WithId {
	created_at: Date;
}

export interface PineDeferred {
	__id: number;
}

/**
 * When not selected-out holds a deferred.
 * When expanded hold an array with a single element.
 */
export type NavigationResource<T = WithId> = T[] | PineDeferred;

/**
 * When expanded holds an array, otherwise the property is not present.
 * Selecting is not suggested,
 * in that case it holds a deferred to the original resource.
 */
export type ReverseNavigationResource<T = WithId> = T[] | undefined;

export function getExpanded<T>(obj: PineDeferred): undefined;
export function getExpanded<T>(obj: NavigationResource<T>): T | undefined;
export function getExpanded<T>(obj: NavigationResource<T>): T | undefined {
	return (_.isArray(obj) && obj[0]) || undefined;
}
