import { metrics } from '@balena/node-metrics-gatherer';

enum names {
	api_device_logs_current_subscriptions = 'api_device_logs_current_subscriptions',
	api_device_logs_subscription_total = 'api_device_logs_subscription_total',
	api_device_logs_publish_log_messages_total = 'api_device_logs_publish_log_messages_total',
	api_device_logs_publish_log_messages_dropped = 'api_device_logs_publish_log_messages_dropped',
	api_device_logs_publish_call_total = 'api_device_logs_publish_call_total',
	api_device_logs_publish_call_success_total = 'api_device_logs_publish_call_success_total',
	api_device_logs_publish_call_failed_total = 'api_device_logs_publish_call_failed_total',
	api_device_logs_loki_push_total = 'api_device_logs_loki_push_total',
	api_device_logs_loki_push_error_total = 'api_device_logs_loki_push_error_total',
	api_device_logs_loki_push_duration_milliseconds = 'api_device_logs_loki_push_duration_milliseconds',
}

metrics.describe.gauge(
	names.api_device_logs_current_subscriptions,
	'Current number of log subscriptions',
);

metrics.describe.counter(
	names.api_device_logs_subscription_total,
	'Total count of log subscriptions',
);

metrics.describe.counter(
	names.api_device_logs_publish_log_messages_total,
	'Total count of logs messages published',
);

metrics.describe.counter(
	names.api_device_logs_publish_log_messages_dropped,
	'Total count of logs messages dropped',
);

metrics.describe.counter(
	names.api_device_logs_publish_call_total,
	'Total count of publish calls',
);

metrics.describe.counter(
	names.api_device_logs_publish_call_success_total,
	'Total count of successful publish calls',
);

metrics.describe.counter(
	names.api_device_logs_publish_call_failed_total,
	'Total count of failed to publish calls',
);

metrics.describe.counter(
	names.api_device_logs_loki_push_error_total,
	'Total count of Loki push errors, labelled by code',
	{
		labelNames: ['errorCode'],
	},
);

metrics.describe.histogram(
	names.api_device_logs_loki_push_duration_milliseconds,
	'histogram of push request times',
	{
		buckets: [
			4, 16, 50, 100, 250, 500, 1000, 1500, 3000, 8000, 10000, 20000, 30000,
		],
	},
);

export function setCurrentSubscriptions(value: number) {
	metrics.gauge(names.api_device_logs_current_subscriptions, value);
}

export function incrementSubscriptionTotal(value: number = 1) {
	metrics.counter(names.api_device_logs_subscription_total, value);
}

export function incrementPublishLogMessagesTotal(value: number = 1) {
	metrics.counter(names.api_device_logs_publish_log_messages_total, value);
}

export function incrementPublishLogMessagesDropped(value: number = 1) {
	metrics.counter(names.api_device_logs_publish_log_messages_dropped, value);
}

export function incrementPublishCallTotal(value: number = 1) {
	metrics.counter(names.api_device_logs_publish_call_total, value);
}

export function incrementPublishCallSuccessTotal(value: number = 1) {
	metrics.counter(names.api_device_logs_publish_call_success_total, value);
}

export function incrementPublishCallFailedTotal(value: number = 1) {
	metrics.counter(names.api_device_logs_publish_call_failed_total, value);
}

export function incrementLokiPushTotal(value: number = 1) {
	metrics.counter(names.api_device_logs_loki_push_total, value);
}

export function incrementLokiPushErrorTotal(
	errorCode: string,
	value: number = 1,
) {
	metrics.counter(names.api_device_logs_loki_push_error_total, value, {
		errorCode,
	});
}

export function updateLokiPushDurationHistogram(duration: number) {
	metrics.histogram(
		names.api_device_logs_loki_push_duration_milliseconds,
		duration,
	);
}
