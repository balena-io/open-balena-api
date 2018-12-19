const numWorkers = process.env.NUM_WORKERS || require('os').cpus().length;
if (numWorkers > 1) {
	const cluster = require('cluster');
	if (cluster.isMaster) {
		console.log(`Forking ${numWorkers} workers`);
		for (let i = 0; i < numWorkers; i++) {
			console.log(`Forking worker ${i}`);
			cluster.fork(process.env);
		}

		cluster.on('exit', worker => {
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

// Support `require()` of *.ts files
process.env.TS_NODE_CACHE_DIRECTORY = '.ts-node';
require('ts-node/register/transpile-only');

const _ = require('lodash');
const express = require('express');
const { setup } = require('./src');

function onInitMiddleware(app) {
	const { forwardRequests } = require('./src/platform/versions');
	forwardRequests(app, 'v5', 'resin');
}

function onInitModel() {
	const { runInTransaction, updateOrInsertModel } = require('./src/platform');
	const appTypes = require('./src/lib/application-types');
	const insert = _.cloneDeep(appTypes.Default);
	const filter = { slug: insert.slug };
	delete insert.slug;
	return runInTransaction(tx =>
		updateOrInsertModel('application_type', filter, insert, tx),
	);
}

function onInitHooks() {
	const { runInTransaction } = require('./src/platform');
	const { createAll } = require('./src/platform/permissions');
	const auth = require('./src/lib/auth');
	const permissionNames = _.uniq(
		_.flatMap(auth.ROLES).concat(_.flatMap(auth.KEYS, 'permissions')),
	);
	return runInTransaction(tx =>
		createAll(tx, permissionNames, auth.ROLES, auth.KEYS, {}),
	);
}

function createSuperuser() {
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = require('./src/lib/config');

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		return;
	}

	console.log('Creating superuser account...');

	const { runInTransaction, sbvrUtils } = require('./src/platform');
	const {
		registerUser,
		updatePasswordIfNeeded,
	} = require('./src/platform/auth');
	const { ConflictError } = sbvrUtils;

	const data = {
		username: 'root',
		email: SUPERUSER_EMAIL,
		password: SUPERUSER_PASSWORD,
	};

	return runInTransaction(tx =>
		registerUser(data, tx)
			.then(() => {
				console.log('Superuser created successfully!');
			})
			.catch(ConflictError, () => {
				console.log('Superuser already exists!');
				return updatePasswordIfNeeded(data.username, SUPERUSER_PASSWORD).then(
					updated => {
						if (updated) {
							console.log('Superuser password changed.');
						}
					},
				);
			}),
	).catch(err => {
		console.error('Error creating superuser:', err);
	});
}

const app = express();
app.enable('trust proxy');

setup(app, {
	configPath: __dirname + '/config.json',
	version: require('./package.json').version,
	onInitMiddleware,
	onInitModel,
	onInitHooks,
})
	.tap(createSuperuser)
	.then(({ startServer, runFromCommandLine }) => {
		if (process.argv.length > 2) {
			return runFromCommandLine();
		}
		return startServer(process.env.PORT || 1337);
	})
	.catch(err => {
		console.error('Failed to initialize:', err);
		process.exit(1);
	});
