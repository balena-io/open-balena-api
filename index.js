const numWorkers = process.env.NUM_WORKERS || require('os').cpus().length
if (numWorkers > 1) {
	const cluster = require('cluster')
	if (cluster.isMaster) {
		console.log(`Forking ${numWorkers} workers`)
		for (let i = 0; i < numWorkers; i++) {
			console.log(`Forking worker ${i}`)
			cluster.fork(process.env)
		}

		cluster.on('exit', (worker) => {
			console.log('Worker ' + worker.id + ' died, replacing it')
			cluster.fork(process.env)
		})
		return
	}
}

// Use fast-boot to cache require lookups, speeding up startup
require('fast-boot').start({
	cacheFile: '.fast-boot.json'
})

// Support `require()` of *.coffee files
process.env.COFFEE_CACHE_DIR = '.coffee'
require('coffee-cache')

// Support `require()` of *.ts files
process.env.TS_NODE_CACHE_DIRECTORY = '.ts-node'
require('ts-node/register/transpile-only')

const _ = require('lodash')
const express = require('express')
const { setup } = require('./src')

function onInitMiddleware(app) {
	const { forwardRequests } = require('./src/platform/versions')
	forwardRequests(app, 'v4', 'resin')
}

function onInitModel() {
	const { runInTransaction, updateOrInsertModel } = require('./src/platform')
	const appTypes = require('./src/lib/application-types')
	const insert = _.cloneDeep(appTypes.Default)
	const filter = { slug: insert.slug }
	delete insert.slug
	return runInTransaction(tx =>
		updateOrInsertModel('application_type', filter, insert, tx)
	)
}

function onInitHooks() {
	const { runInTransaction } = require('./src/platform')
	const { createAll } = require('./src/platform/permissions')
	const auth = require('./src/lib/auth')
	const permissionNames = _.uniq(
		_.flatMap(auth.ROLES)
		.concat(_.flatMap(auth.KEYS, 'permissions')),
	)
	return runInTransaction(tx =>
		createAll(tx, permissionNames, auth.ROLES, auth.KEYS, {})
	)
}

const app = express()
app.enable('trust proxy')

setup(app, {
	configPath: __dirname + '/config.json',
	version: require('./package.json').version,
	onInitMiddleware,
	onInitModel,
	onInitHooks,
})
.then(({ startServer, runFromCommandLine }) => {
	if (process.argv.length > 2) {
		return runFromCommandLine()
	}
	return startServer(process.env.PORT || 1337)
})
.catch(err => {
	console.error('Failed to initialize:', err)
	process.exit(1)
})
