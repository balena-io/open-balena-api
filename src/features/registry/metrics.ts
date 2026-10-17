import { metrics } from '@balena/node-metrics-gatherer';

metrics.describe.counter(
	'api_registry_resolve_image_id_total',
	'Total count of registry image id lookups, labelled by lookup strategy and whether an image was found',
	{
		labelNames: ['strategy', 'result'],
	},
);

metrics.describe.histogram(
	'api_registry_resolve_image_id_duration_milliseconds',
	'Histogram of registry image id lookup durations, labelled by lookup strategy and whether an image was found',
	{
		labelNames: ['strategy', 'result'],
		buckets: [
			4, 16, 50, 100, 250, 500, 1000, 1500, 3000, 8000, 10000, 20000, 30000,
		],
	},
);

export type ResolveImageIdStrategy =
	// exact match on `${REGISTRY2_HOST}/v2/<hash>`
	| 'exact_match'
	// `$endswith` lookup after the exact match didn't find an image
	| 'endswith_fallback'
	// `$endswith` lookup for non v2/<hash> names, where no exact match is attempted
	| 'endswith';

export const recordResolveImageIdMetrics = (
	strategy: ResolveImageIdStrategy,
	found: boolean,
	durationMs: number,
) => {
	const labels = {
		strategy,
		result: found ? 'found' : 'not_found',
	};
	metrics.counter('api_registry_resolve_image_id_total', 1, labels);
	metrics.histogram(
		'api_registry_resolve_image_id_duration_milliseconds',
		durationMs,
		labels,
	);
};
