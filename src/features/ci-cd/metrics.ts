import { metrics } from '@balena/node-metrics-gatherer';

enum names {
	api_task_service_installs_created = 'api_task_service_installs_created',
	api_task_service_installs_time_ms = 'api_task_service_installs_time_ms',
	api_task_service_installs_device = 'api_task_service_installs_device',
}

metrics.describe.counter(
	names.api_task_service_installs_created,
	'Total count of service installs created',
);

metrics.describe.counter(
	names.api_task_service_installs_device,
	'Total count of devices with service installs',
);

metrics.describe.histogram(
	names.api_task_service_installs_time_ms,
	'histogram of service install creation times',
	{
		buckets: [
			4, 16, 50, 100, 250, 500, 1000, 1500, 3000, 8000, 10000, 20000, 30000,
		],
	},
);

export function incrementServiceInstalls(value = 1) {
	metrics.counter(names.api_task_service_installs_created, value);
}

export function incrementServiceInstallsDevice(value = 1) {
	metrics.counter(names.api_task_service_installs_device, value);
}

export function updateServiceInstallDurationTime(duration: number) {
	metrics.histogram(names.api_task_service_installs_time_ms, duration);
}
