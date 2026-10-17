const start = async () => {
	// Set the desired es version for downstream modules that support it
	(await import('@balena/es-version')).set('es2022');

	if (process.env.SENTRY_DSN) {
		// Sentry instruments express as it is loaded in order to capture its errors,
		// so this must be imported before anything that imports express
		// @ts-expect-error This entrypoint has no type declarations
		await import('@sentry/node/import');
	}

	const { SentryPropagator } = await import('@sentry/opentelemetry');
	const { trace } = await import('@opentelemetry/api');
	const {
		CompositePropagator,
		W3CTraceContextPropagator,
		W3CBaggagePropagator,
		isTracingSuppressed,
	} = await import('@opentelemetry/core');
	const { AsyncLocalStorageContextManager } =
		await import('@opentelemetry/context-async-hooks');
	const { NodeSDK } = await import('@opentelemetry/sdk-node');
	const { ExpressInstrumentation } =
		await import('@opentelemetry/instrumentation-express');
	const { HttpInstrumentation } =
		await import('@opentelemetry/instrumentation-http');

	const sentryPropagator = new SentryPropagator();

	const sdk = new NodeSDK({
		contextManager: new AsyncLocalStorageContextManager(),
		textMapPropagator: new CompositePropagator({
			propagators: [
				new W3CTraceContextPropagator(),
				new W3CBaggagePropagator(),
				{
					// Continue traces from incoming `sentry-trace` headers
					extract: (context, carrier, getter) =>
						sentryPropagator.extract(context, carrier, getter),
					// SentryPropagator can only inject when Sentry owns the OpenTelemetry setup,
					// so we add `sentry-trace` ourselves, leaving the sampling decision to the
					// receiver since we don't send spans to Sentry
					inject(context, carrier, setter) {
						const spanContext = trace.getSpanContext(context);
						if (
							spanContext == null ||
							!trace.isSpanContextValid(spanContext) ||
							isTracingSuppressed(context)
						) {
							return;
						}
						setter.set(
							carrier,
							'sentry-trace',
							`${spanContext.traceId}-${spanContext.spanId}`,
						);
					},
					fields: () => ['sentry-trace'],
				},
			],
		}),
		// We don't export spans, but NodeSDK only registers a tracer provider (which we need
		// for trace ids) when there is a span processor, otherwise defaulting to OTLP export
		spanProcessors: [
			{
				onStart() {
					// noop
				},
				onEnd() {
					// noop
				},
				async forceFlush() {
					// noop
				},
				async shutdown() {
					// noop
				},
			},
		],
		instrumentations: [new ExpressInstrumentation(), new HttpInstrumentation()],
	});

	sdk.start();

	await import('./init.js');
};

const numWorkers =
	parseInt(process.env.NUM_WORKERS ?? '0', 10) ||
	(await import('os')).cpus().length;
if (numWorkers > 1) {
	const { default: cluster } = await import('cluster');
	if (cluster.isPrimary) {
		// Setup the RateLimiterCluster store on the master worker
		const { RateLimiterClusterMaster } = await import('rate-limiter-flexible');
		new RateLimiterClusterMaster();

		console.log(`Forking ${numWorkers} workers`);
		for (let i = 0; i < numWorkers; i++) {
			console.log(`Forking worker ${i}`);
			cluster.fork(process.env);
		}

		cluster.on('exit', (worker) => {
			console.log('Worker ' + worker.id + ' died, replacing it');
			cluster.fork(process.env);
		});
	} else {
		await start();
	}
} else {
	await start();
}
