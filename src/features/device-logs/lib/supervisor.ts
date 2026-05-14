import { errors } from '@balena/pinejs';

import type {
	InternalDeviceLog,
	OldSupervisorLog,
	SupervisorLog,
} from './struct.js';
import { getNanoTimestamp } from '../../../lib/utils.js';

const MAX_LOGS_PER_BATCH = 10;

export function convertLogs(logs: SupervisorLog[]): InternalDeviceLog[] {
	if (logs.length > MAX_LOGS_PER_BATCH) {
		throw new errors.BadRequestError(
			`Batches cannot include more than ${MAX_LOGS_PER_BATCH} logs`,
		);
	}
	return logs
		.values()
		.map(convertAnyLog)
		.filter((log) => log != null)
		.toArray();
}

function convertAnyLog(log: SupervisorLog): InternalDeviceLog | undefined {
	if (isOldLog(log)) {
		// Old format supervisor logs are no longer supported
		throw new errors.BadRequestError();
	}
	return convertLog(log);
}

export function convertLog(log: {
	[key in keyof SupervisorLog]: unknown;
}): InternalDeviceLog | undefined {
	// see struct.ts for explanation on this
	if (log.uuid) {
		return;
	}
	if (typeof log.message !== 'string') {
		throw new errors.BadRequestError('DeviceLog message must be string');
	}
	if (typeof log.timestamp !== 'number') {
		throw new errors.BadRequestError('DeviceLog timestamp must be number');
	}
	const validatedLog: InternalDeviceLog = {
		nanoTimestamp: getNanoTimestamp(),
		timestamp: log.timestamp,
		isSystem: log.isSystem === true,
		isStdErr: log.isStdErr === true,
		message: log.message,
	};
	if ('serviceId' in log) {
		if (typeof log.serviceId !== 'number') {
			throw new errors.BadRequestError(
				'DeviceLog serviceId must be number or undefined',
			);
		}
		validatedLog.serviceId = log.serviceId;
	}
	return validatedLog;
}

function isOldLog(log: any): log is OldSupervisorLog {
	const old: OldSupervisorLog = log;
	return old.is_stderr != null || old.is_system != null || old.image_id != null;
}
