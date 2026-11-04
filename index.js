// Enable automatic schema compilation for zod
// This must run before any schemas are defined
import 'zod/compile';

const start = async () => {
	// Set the desired es version for downstream modules that support it
	(await import('@balena/es-version')).set('es2022');

	const { SentrySpanProcessor, SentryPropagator, wrapContextManagerClass } =
		await import('@sentry/opentelemetry');
	const { context } = await import('@opentelemetry/api');
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

	const SentryContextManager = wrapContextManagerClass(
		AsyncLocalStorageContextManager,
	);

	const sdk = new NodeSDK({
		contextManager: new SentryContextManager(),
		textMapPropagator: new CompositePropagator({
			propagators: [
				new W3CTraceContextPropagator(),
				new W3CBaggagePropagator(),
				new SentryPropagator(),
			],
		}),
		spanProcessors: [new SentrySpanProcessor()],
		instrumentations: [
			new ExpressInstrumentation(),
			new HttpInstrumentation({
				// Skip outgoing requests made with tracing suppressed, eg Loki pushes and Sentry's own requests, which
				// would otherwise still go through the instrumentation, only with a non-recording span
				ignoreOutgoingRequestHook: () => isTracingSuppressed(context.active()),
			}),
		],
	});

	sdk.start();

	await import('./init.ts');
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
