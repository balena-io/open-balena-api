import { metrics } from '@balena/node-metrics-gatherer';

metrics.describe.counter(
	'api_registry_image_pull_total',
	'Number of image pulls getting the token via API',
);

export function incrementRegistryImagePulls(
	value: number = 1,
	payload: any = {},
) {
	metrics.counter('api_registry_image_pull_total', value, payload);
}
