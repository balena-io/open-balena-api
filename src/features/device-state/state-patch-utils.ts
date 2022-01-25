import { LocalBody } from './routes/state-patch-v2';

export const v2ValidPatchFields: Array<Exclude<keyof LocalBody, 'apps'>> = [
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
