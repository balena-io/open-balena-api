import type { Filter } from 'pinejs-client-core';
import type { Device, ImageInstall } from '../../balena-model.js';
import type { StatePatchV2Body } from './routes/state-patch-v2.js';
import type { StatePatchV3Body } from './routes/state-patch-v3.js';
import {
	DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS,
	IMAGE_INSTALL_CACHE_TIMEOUT_SECONDS,
	METRICS_MAX_INTEGER_VALUE,
	METRICS_MAX_REPORT_INTERVAL_SECONDS,
} from '../../lib/config.js';
import { createMultiLevelStore } from '../../infra/cache/index.js';
import type { sbvrUtils } from '@balena/pinejs';
import { permissions } from '@balena/pinejs';
import { ThisShouldNeverHappenError } from '../../infra/error-handling/index.js';

export const v3ValidPatchFields = [
	'status',
	'is_online',
	'os_version',
	'os_variant',
	'supervisor_version',
	'provisioning_progress',
	'provisioning_state',
	'ip_address',
	'mac_address',
	'api_port',
	'api_secret',
	'cpu_id',
	'is_undervolted',
	'update_status',
] satisfies Array<
	Exclude<keyof StatePatchV3Body[string], 'apps'> | 'update_status'
>;

export const v2ValidPatchFields: Array<
	Exclude<keyof NonNullable<StatePatchV2Body['local']>, 'apps'>
> = [
	...v3ValidPatchFields.filter((f) => f !== 'update_status'),
	'device_name',
	'note',
	'download_progress',
];

const ADDRESS_DELIMITER = ' ';

// Truncate text at delimiters to input length or less
const truncateText = (
	longText: string,
	length: number,
	delimiter: string | null,
): string => {
	if (delimiter == null) {
		return longText.substring(0, length);
	}
	return longText
		.split(delimiter)
		.reduce((text, fragment) => {
			const textWithFragment = text + delimiter + fragment;
			return textWithFragment.length <= length ? textWithFragment : text;
		}, '')
		.trim();
};

type ValidPatchField =
	| (typeof v3ValidPatchFields)[number]
	| (typeof v2ValidPatchFields)[number];

const constrainedDeviceTextFields = [
	['ip_address', 2000, ADDRESS_DELIMITER],
	['mac_address', 900, ADDRESS_DELIMITER],
] satisfies Array<
	[ValidPatchField, maxLength: number, delimiter: string | null]
>;
export function truncateConstrainedDeviceFields<
	T extends Partial<
		Pick<Device['Write'], (typeof constrainedDeviceTextFields)[number][0]>
	>,
>(object: T, deviceId: number): T {
	for (const [key, maxLength, delimiter] of constrainedDeviceTextFields) {
		if (typeof object[key] !== 'string' || object[key].length <= maxLength) {
			continue;
		}
		ThisShouldNeverHappenError(
			`Device ${deviceId} sent a(n) ${key} that was too long and had to be truncated: ${object[key].length} chars`,
		);
		object[key] = truncateText(object[key], maxLength, delimiter);
	}
	return object;
}

export function normalizeStatePatchDeviceBody<
	T extends { os_variant?: string },
>(deviceBody: T, uuid: string) {
	if (
		deviceBody.os_variant != null &&
		deviceBody.os_variant !== 'dev' &&
		deviceBody.os_variant !== 'prod'
	) {
		ThisShouldNeverHappenError(
			`Received unexpected device.os_variant: '${deviceBody.os_variant}' from device: ${uuid}`,
		);
		delete deviceBody.os_variant;
	}
	return deviceBody as T & Partial<Pick<Device['Write'], 'os_variant'>>;
}

const metricsPatchNumbers = [
	'memory_usage',
	'memory_total',
	'storage_usage',
	'storage_total',
	'cpu_temp',
	'cpu_usage',
] as const;

export const metricsPatchFields = [
	...metricsPatchNumbers,
	'storage_block_device',
] as const;

// Limit the values of the metrics to safe values
export function limitMetricNumbers(
	body: Partial<Record<(typeof metricsPatchNumbers)[number], number>>,
): void {
	for (const key of metricsPatchNumbers) {
		const value = body[key];
		if (typeof value === 'number' && value > METRICS_MAX_INTEGER_VALUE) {
			body[key] = METRICS_MAX_INTEGER_VALUE;
		}
	}
}

export const shouldUpdateMetrics = (() => {
	const lastMetricsReportTime = createMultiLevelStore<number>(
		'lastMetricsReportTime',
		{
			default: {
				ttl: METRICS_MAX_REPORT_INTERVAL_SECONDS,
			},
			useVersion: false,
		},
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
	status?: ImageInstall['Write']['status'];
	is_provided_by__release: number;
	download_progress?: number | null;
};
const shouldUpdateImageInstall = (() => {
	const lastImageInstallReport = createMultiLevelStore<
		ImageInstallUpdateBody & { updateTime: number }
	>('lastImageInstallUpdate', {
		default: {
			ttl: IMAGE_INSTALL_CACHE_TIMEOUT_SECONDS,
		},
		// Do not have a local cache to avoid skipping updates based on an
		// outdated local cache
		local: false,
		useVersion: false,
	});
	const DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL =
		DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS * 1000;
	return async (imageInstallId: number, body: ImageInstallUpdateBody) => {
		const key = `${imageInstallId}`;
		const lastReport = await lastImageInstallReport.get(key);
		const now = Date.now();
		if (
			lastReport == null ||
			// If the download progress has changed and the entry has expired then it means we should actually do the report
			(lastReport.download_progress !== body.download_progress &&
				lastReport.updateTime + DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL < now) ||
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

const imageInstallKnownStatuses = [
	'Downloading',
	'Downloaded',
	'Installing',
	'Installed',
	'Starting',
	'Running',
	'Idle',
	'Handing over',
	'Awaiting handover',
	'Stopping',
	'Stopped',
	'exited',
	'Deleting',
	'deleted',
	'Dead',
	'paused',
	'restarting',
	'removing',
	'configuring',
	'Unknown',
] as const;

function normalizeImageInstallStatus(
	deviceId: number,
	status: string | undefined,
): (typeof imageInstallKnownStatuses)[number] | undefined {
	if (
		status != null &&
		!imageInstallKnownStatuses.includes(
			status as (typeof imageInstallKnownStatuses)[number],
		)
	) {
		ThisShouldNeverHappenError(
			`Received unexpected image_install.status: '${status}' from device: ${deviceId}`,
		);
		return undefined;
	}
	return status as (typeof imageInstallKnownStatuses)[number] | undefined;
}

export const upsertImageInstall = async (
	resinApi: typeof sbvrUtils.api.resin,
	imgInstall: Pick<ImageInstall['Read'], 'id'>,
	{
		imageId,
		releaseId,
		status: $status,
		downloadProgress,
	}: {
		imageId: number;
		releaseId: number;
		status?: string;
		downloadProgress?: number | null;
	},
	deviceId: number,
): Promise<void> => {
	const status = normalizeImageInstallStatus(deviceId, $status);

	if (imgInstall == null) {
		// we need to create it with a POST
		await resinApi.post({
			resource: 'image_install',
			body: {
				device: deviceId,
				installs__image: imageId,
				install_date: new Date(),
				status,
				download_progress: downloadProgress,
				is_provided_by__release: releaseId,
			},
			options: { returnResource: false },
		});
	} else {
		// we need to update the current image install
		const body: ImageInstallUpdateBody = {
			is_provided_by__release: releaseId,
		};
		if (status !== undefined) {
			body.status = status;
		}
		if (downloadProgress !== undefined) {
			body.download_progress = downloadProgress;
		}
		if (await shouldUpdateImageInstall(imgInstall.id, body)) {
			await resinApi.patch({
				resource: 'image_install',
				id: imgInstall.id,
				body,
				options: {
					$filter: {
						$not: body,
					},
				},
			});
		}
	}
};

export const deleteOldImageInstalls = async (
	resinApi: typeof sbvrUtils.api.resin,
	deviceId: number,
	imageIds: number[],
): Promise<void> => {
	// Get access to a root api, as images shouldn't be allowed to change
	// the service_install values
	const rootApi = resinApi.clone({
		passthrough: { req: permissions.root },
	});

	const body = { status: 'deleted' as const, download_progress: null };
	const filter: Filter<ImageInstall['Read']> = {
		device: deviceId,
	};
	if (imageIds.length !== 0) {
		filter.$not = [body, { image: { $in: imageIds } }];
	} else {
		filter.$not = body;
	}

	await rootApi.patch({
		resource: 'image_install',
		body,
		options: {
			$filter: filter,
		},
	});
};
