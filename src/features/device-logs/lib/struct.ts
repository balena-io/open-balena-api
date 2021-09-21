export interface LogContext {
	id: number;
	uuid: string;
	belongs_to__application: number;
	logs_channel?: string;
	retention_limit?: number;
	backend?: string;
}

export interface LogWriteContext extends LogContext {
	images: Array<{
		id: number;
		serviceId: number;
	}>;
}

// This is the format we store and that we output to consumers
export interface DeviceLog {
	message: string;
	nanoTimestamp: bigint;
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
	history(ctx: LogContext, count: number): Promise<DeviceLog[]>;
	available: boolean;
	// `logs` will be mutated to empty and so must be handled synchronously
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
