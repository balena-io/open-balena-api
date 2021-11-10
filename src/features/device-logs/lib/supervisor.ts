import * as _ from 'lodash';

import { errors } from '@balena/pinejs';

import type { DeviceLog, OldSupervisorLog, SupervisorLog } from './struct';
import { getNanoTimestamp } from '../../../lib/utils';
import { BadRequestError } from '@balena/pinejs/out/sbvr-api/errors';

const MAX_LOGS_PER_BATCH = 10;

export class Supervisor {
	public convertLogs(logs: SupervisorLog[]): DeviceLog[] {
		if (logs.length > MAX_LOGS_PER_BATCH) {
			throw new errors.BadRequestError(
				`Batches cannot include more than ${MAX_LOGS_PER_BATCH} logs`,
			);
		}
		return _(logs)
			.map((log) => {
				return this.convertAnyLog(log);
			})
			.compact()
			.value();
	}

	private convertAnyLog(log: SupervisorLog): DeviceLog | undefined {
		if (this.isOldLog(log)) {
			// Old format supervisor logs are no longer supported
			throw new BadRequestError();
		}
		return this.convertLog(log);
	}

	public convertLog(log: SupervisorLog): DeviceLog | undefined {
		// see struct.ts for explanation on this
		if (log.uuid) {
			return;
		}
		return {
			nanoTimestamp: getNanoTimestamp(),
			createdAt: Date.now(),
			timestamp: log.timestamp,
			isSystem: log.isSystem === true,
			isStdErr: log.isStdErr === true,
			message: log.message,
			serviceId: log.serviceId,
		};
	}

	private isOldLog(log: any): log is OldSupervisorLog {
		const old: OldSupervisorLog = log;
		return !!(old.is_stderr || old.is_system || old.image_id);
	}
}
