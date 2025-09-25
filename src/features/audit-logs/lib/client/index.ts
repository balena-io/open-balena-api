// TODO: This entire client should be made avaialable in a shared way (npm) for all backend components

import type { BalenaOrgAction, BalenaUserAction } from './actions.js';

export interface BalenaEvent {
	actorId: number;
	actorDisplayName: string;
	metadata?: AnyObject;
}

export interface BalenaUserEvent extends BalenaEvent {
	action: BalenaUserAction; // TODO: Do we want to explicitely define all possible actions?
	// I would say "YES", for the reason of having a central place, on code, where we explicitely define
	// everything that could ever be logged forces us to think and do the additional step of adding to that list
	// It can easily be dropped if we get to the conclusion that adding to the list is too troublesome
	userId: number;
}

export interface BalenaOrgEvent extends BalenaEvent {
	action: BalenaOrgAction; // TODO: Do we want to explicitely define all possible actions?
	// I would say "YES", for the reason of having a central place, on code, where we explicitely define
	// everything that could ever be logged forces us to think and do the additional step of adding to that list
	// It can easily be dropped if we get to the conclusion that adding to the list is too troublesome
	organizationId: number;
	resource: string | string[];
}

export type QueryPayload = {
	start: string;
	end: string;
	// Not on fibery but make sense imho
	limit?: number;
	direction?: 'backward' | 'forward';
	// log info filters
	actorId?: number;
	action?: BalenaUserAction | BalenaOrgAction;
	resource?: string;
	// TODO output format JSON vs LOG: assuming only json for now
} & (
		| { userId: number }
		| { orgId: number | [number, ...number[]] } // at least one element
		| { userId: number; orgId: number | [number, ...number[]] } // at least one element
	);

export interface BalenaAuditLogClient {
	logUserEvent: (userEvent: BalenaUserEvent) => Promise<void>;
	logOrgEvent: (orgEvent: BalenaOrgEvent) => Promise<void>;
	query: (
		payload: QueryPayload,
	) => Promise<Array<(BalenaUserEvent | BalenaOrgEvent) & { timestamp: string }>>;
}
