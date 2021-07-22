const numWorkers = process.env.NUM_WORKERS || require('os').cpus().length;
if (numWorkers > 1) {
	const cluster = require('cluster');
	if (cluster.isMaster) {
		// Setup the RateLimiterCluster store on the master worker
		const { RateLimiterClusterMaster } = require('rate-limiter-flexible');
		// tslint:disable-next-line:no-unused-expression-chai
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
		return;
	}
}

// Use fast-boot to cache require lookups, speeding up startup
require('fast-boot2').start({
	cacheFile: '.fast-boot.json',
});

// Set the desired es version for downstream modules that support it
require('@balena/es-version').set('es2020');

// Support `require()` of *.ts files
process.env.TS_NODE_CACHE_DIRECTORY = '.ts-node';
try {
	require('ts-node/register/transpile-only');
} catch (e) {
	// Ignore failure to load ts-node as it should be from running in a container
	// where the ts code has already been compiled
}

require('./init.ts');
