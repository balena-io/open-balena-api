import * as Promise from 'bluebird';
import { Request } from 'express';
import { PinejsClient } from '../../platform';

export interface LogContext {
	id: number;
	uuid: string;
	logs_channel?: string;
	retention_limit?: number;
	resinApi: PinejsClient;
	req: Request;
}

export interface LogWriteContext extends LogContext {
	image_install: Array<{
		id: number;
		image: Array<{
			id: number;
			is_a_build_of__service: Array<{
				id: number;
			}>;
		}>;
	}>;
}

// This is the format we store and that we output to consumers
export interface DeviceLog {
	message: string;
	// These 2 dates are timestamps including milliseconds
	createdAt: number;
	timestamp: number;
	isSystem: boolean;
	isStdErr: boolean;
	serviceId?: number;
}

// This is the format we get from new supervisors
export interface SupervisorLog {
	message: string;
	timestamp: number;
	isSystem?: boolean;
	isStdErr?: boolean;
	serviceId?: number;
	// To support dependent devices in the future, the supervisor sends their uuid
	// TODO: For now, we just ignore these logs for the first iteration
	uuid?: string;
}

// This is the format we get from old supervisors
export interface OldSupervisorLog {
	message: string;
	timestamp: number;
	is_system?: boolean;
	is_stderr?: boolean;
	image_id?: number;
}

// Create a type that contain both possible sets of fields
export type AnySupervisorLog = OldSupervisorLog | SupervisorLog;

export type Subscription = (log: DeviceLog) => void;

export interface DeviceLogsBackend {
	history(ctx: LogContext): Promise<DeviceLog[]>;
	available: boolean;
	publish(ctx: LogWriteContext, logs: DeviceLog[]): Promise<any>;
	subscribe(ctx: LogContext, subscription: Subscription): void;
	unsubscribe(ctx: LogContext, subscription: Subscription): void;
}

export enum StreamState {
	Buffering,
	Flushing,
	Writable,
	Saturated,
	Closed,
}
