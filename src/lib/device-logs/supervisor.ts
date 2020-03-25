import * as _ from 'lodash';

import { sbvrUtils } from '@resin/pinejs';

import {
	AnySupervisorLog,
	DeviceLog,
	LogWriteContext,
	OldSupervisorLog,
	SupervisorLog,
} from './struct';

const MAX_LOGS_PER_BATCH = 10;

export class Supervisor {
	public convertLogs(
		ctx: LogWriteContext,
		logs: AnySupervisorLog[],
	): DeviceLog[] {
		if (logs.length > MAX_LOGS_PER_BATCH) {
			throw new sbvrUtils.BadRequestError(
				`Batches cannot include more than ${MAX_LOGS_PER_BATCH} logs`,
			);
		}
		return _(logs)
			.map((log) => {
				return this.convertAnyLog(ctx, log);
			})
			.compact()
			.value();
	}

	private convertAnyLog(
		ctx: LogWriteContext,
		log: AnySupervisorLog,
	): DeviceLog | undefined {
		return this.isOldLog(log)
			? this.convertOldLog(ctx, log)
			: this.convertLog(log);
	}

	public convertLog(log: SupervisorLog): DeviceLog | undefined {
		// see struct.ts for explanation on this
		if (log.uuid) {
			return;
		}
		return {
			createdAt: Date.now(),
			timestamp: log.timestamp,
			isSystem: log.isSystem === true,
			isStdErr: log.isStdErr === true,
			message: log.message,
			serviceId: log.serviceId,
		};
	}

	private isOldLog(log: AnySupervisorLog): log is OldSupervisorLog {
		const old: OldSupervisorLog = log;
		return !!(old.is_stderr || old.is_system || old.image_id);
	}

	private convertOldLog(
		ctx: LogWriteContext,
		log: OldSupervisorLog,
	): DeviceLog | undefined {
		let serviceId: number | undefined;
		if (log.image_id) {
			serviceId = this.getServiceId(ctx, log);
			// Filter out (ignore) logs where we didn't find the image install
			if (!serviceId) {
				return;
			}
		}
		return {
			createdAt: Date.now(),
			timestamp: log.timestamp,
			isSystem: log.is_system === true,
			isStdErr: log.is_stderr === true,
			message: log.message,
			serviceId,
		};
	}

	private getServiceId(
		ctx: LogWriteContext,
		log: OldSupervisorLog,
	): number | undefined {
		for (const img of ctx.images) {
			if (img.id === log.image_id) {
				return img.serviceId;
			}
		}
	}
}
