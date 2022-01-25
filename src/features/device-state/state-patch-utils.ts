import { StatePatchV2Body } from './routes/state-patch-v2';
import {
	DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS,
	METRICS_MAX_REPORT_INTERVAL_SECONDS,
} from '../../lib/config';
import { createMultiLevelStore } from '../../infra/cache';

export const v2ValidPatchFields: Array<
	Exclude<keyof NonNullable<StatePatchV2Body['local']>, 'apps'>
> = [
	'is_managed_by__device',
	'should_be_running__release',
	'device_name',
	'status',
	'is_online',
	'note',
	'os_version',
	'os_variant',
	'supervisor_version',
	'provisioning_progress',
	'provisioning_state',
	'ip_address',
	'mac_address',
	'download_progress',
	'api_port',
	'api_secret',
	'logs_channel',
	'cpu_id',
	'is_undervolted',
];

export const metricsPatchFields = [
	'memory_usage',
	'memory_total',
	'storage_block_device',
	'storage_usage',
	'storage_total',
	'cpu_temp',
	'cpu_usage',
] as const;

export const shouldUpdateMetrics = (() => {
	const lastMetricsReportTime = createMultiLevelStore<number>(
		'lastMetricsReportTime',
		{
			ttl: METRICS_MAX_REPORT_INTERVAL_SECONDS,
		},
		false,
	);
	const METRICS_MAX_REPORT_INTERVAL =
		METRICS_MAX_REPORT_INTERVAL_SECONDS * 1000;
	return async (uuid: string) => {
		const lastMetricsUpdate = await lastMetricsReportTime.get(uuid);
		const now = Date.now();
		// If the entry has expired then it means we should actually do the report
		if (
			lastMetricsUpdate == null ||
			lastMetricsUpdate + METRICS_MAX_REPORT_INTERVAL < now
		) {
			// And we add a new entry
			await lastMetricsReportTime.set(uuid, now);
			return true;
		}
		return false;
	};
})();

export type ImageInstallUpdateBody = {
	status: string;
	is_provided_by__release: number;
	download_progress?: number | null;
};
export const shouldUpdateImageInstall = (() => {
	const lastImageInstallReport = createMultiLevelStore<
		ImageInstallUpdateBody & { updateTime: number }
	>(
		'lastImageInstallUpdate',
		{
			ttl: DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS,
		},
		false,
	);
	const DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL =
		DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS * 1000;
	return async (imageInstallId: number, body: ImageInstallUpdateBody) => {
		const key = `${imageInstallId}`;
		const lastReport = await lastImageInstallReport.get(key);
		const now = Date.now();
		if (
			lastReport == null ||
			// If the entry has expired then it means we should actually do the report
			lastReport.updateTime + DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL < now ||
			// Or if the status has changed
			lastReport.status !== body.status ||
			// Or if the release has changed
			lastReport.is_provided_by__release !== body.is_provided_by__release ||
			// Or if the download progress has hit a milestone...
			// From not downloading to downloading
			(lastReport.download_progress == null &&
				body.download_progress != null) ||
			// From downloading to not downloading
			(lastReport.download_progress != null &&
				body.download_progress == null) ||
			// Hits 100%
			body.download_progress === 100
		) {
			// And we add a new entry
			await lastImageInstallReport.set(key, {
				// Keep the last reported download progress if the current report doesn't include it
				download_progress: lastReport?.download_progress,
				...body,
				updateTime: now,
			});
			return true;
		}
		return false;
	};
})();
