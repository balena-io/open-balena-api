export interface LogContext {
	readonly id: number;
	readonly uuid: string;
	readonly retention_limit: number;
}
export interface LokiLogContext extends LogContext {
	readonly orgId: string;
	readonly appId: string;
}

// This is the base format that we receive from consumers after validation
interface DeviceLog {
	message: string;
	// This is a timestamp including milliseconds
	timestamp: number;
	isSystem: boolean;
	isStdErr: boolean;
	serviceId?: number;
}
// This is the format we use internally
export interface InternalDeviceLog extends DeviceLog {
	nanoTimestamp: bigint;
}
// This is the format that we output to consumers
export interface OutputDeviceLog extends DeviceLog {
	createdAt: number;
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
	// Old supervisors can send a timestamp like "2021-11-10T17:50:45.913242000Z"
	timestamp: number | string;
	is_system?: boolean;
	is_stderr?: boolean;
	image_id?: number;
}

export type Subscription = (log: OutputDeviceLog) => void;

export type HistoryOpts = { count: number; start?: number };

export interface DeviceLogsBackend {
	history(ctx: LogContext, opts: HistoryOpts): Promise<OutputDeviceLog[]>;
	available: boolean;
	/**
	 * `logs` will be mutated to empty and so must be handled synchronously
	 */
	publish(ctx: LogContext, logs: InternalDeviceLog[]): Promise<any>;
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
