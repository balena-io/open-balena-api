import { Server } from 'http';
import * as path from 'path';

import * as _ from 'lodash';
import * as _express from 'express';

import * as Promise from 'bluebird';
import * as Raven from 'raven';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import * as methodOverride from 'method-override';
import * as passport from 'passport';

import cookieSession = require('cookie-session');

import * as pine from '@resin/pinejs';
import * as pineEnv from '@resin/pinejs/out/config-loader/env';

import * as jwt from './platform/jwt';
passport.use(jwt.strategy);

import {
	DB_POOL_SIZE,
	SENTRY_DSN,
	NODE_ENV,
	COOKIE_SESSION_SECRET,
} from './lib/config';

import * as _applicationRoutes from './routes/applications';

export const AUTH_PATH = '/auth';

export interface SetupFunction {
	(app: _express.Application): void | PromiseLike<void>;
}

export interface SetupOptions {
	config: Parameters<typeof pine.init>[1]; // must be absolute or relative to `process.cwd()`
	version?: string; // this will be reported along with exceptions to Sentry
	skipHttpsPaths?: string[]; // a list of paths which should be exempt from https redirection

	onInit?: SetupFunction;
	onInitMiddleware?: SetupFunction;
	onInitModel?: SetupFunction;
	onInitHooks?: SetupFunction;
	onInitRoutes?: SetupFunction;
}

export function setup(app: _express.Application, options: SetupOptions) {
	if (DB_POOL_SIZE != null) {
		pineEnv.db.poolSize = DB_POOL_SIZE;
	}

	app.disable('x-powered-by');

	app.use('/connectivity-check', (_req, res) => {
		res.status(204);
		// Remove some automatically added headers, we want the response to be as small as possible
		res.removeHeader('ETag');
		res.removeHeader('Date');
		res.end();
	});

	if (SENTRY_DSN != null) {
		Raven.config(SENTRY_DSN, {
			captureUnhandledRejections: true,
			release: options.version,
			environment: NODE_ENV,
		}).install();
	}

	// redirect to https if needed, except for requests to
	// the /ping endpoint which must always return 200
	app.use(
		fixProtocolMiddleware(['/ping'].concat(options.skipHttpsPaths || [])),
	);

	app.use((_req, res, next) => {
		res.set('X-Frame-Options', 'DENY');
		res.set('X-Content-Type-Options', 'nosniff');
		next();
	});

	app.use((req, res, next) => {
		let origin = req.get('Origin');
		const userAgent = req.get('User-Agent');
		if (!origin && (!userAgent || /^Supervisor|^curl/.test(userAgent))) {
			// The supervisor either sends no user-agent or, more recently, identifies
			// itself as "Supervisor/X.X.X (Linux; Resin OS X.X.X; prod)" and the
			// cron-updater uses curl, all of which ignore CORS, so we can drop the
			// CORS headers to save bandwidth.
			return next();
		}
		origin = origin || '*';
		res.header('Access-Control-Allow-Origin', origin);
		res.header(
			'Access-Control-Allow-Methods',
			'GET, PUT, POST, PATCH, DELETE, OPTIONS, HEAD',
		);
		res.header(
			'Access-Control-Allow-Headers',
			'Content-Type, Authorization, Application-Record-Count, MaxDataServiceVersion, X-Requested-With',
		);
		res.header('Access-Control-Allow-Credentials', 'true');
		res.header('Access-Control-Max-Age', '86400');
		next();
	});

	app.use('/ping', (_req, res) => {
		res.send('OK');
	});

	return Promise.try(runSetupFunction(app, options.onInit))
		.then(() => setupMiddleware(app))
		.then(runSetupFunction(app, options.onInitMiddleware))
		.then(() => pine.init(app, options.config))
		.then(runSetupFunction(app, options.onInitModel))
		.then(() => import('./hooks'))
		.then(runSetupFunction(app, options.onInitHooks))
		.then(() => import('./routes'))
		.then(routes => routes.setup(app))
		.then(runSetupFunction(app, options.onInitRoutes))
		.then(() => app.use(Raven.errorHandler()))
		.return({
			app,
			startServer: _.partial(startServer, app),
			runCommand: _.partial(runCommand, app),
			runFromCommandLine: _.partial(runFromCommandLine, app),
		});
}

function runSetupFunction(app: _express.Application, fn?: SetupFunction) {
	return () => {
		if (fn != null) {
			return fn(app);
		}
	};
}

function fixProtocolMiddleware(skipUrls: string[] = []): _express.Handler {
	return (req, res, next) => {
		if (req.protocol === 'https' || _.includes(skipUrls, req.url)) {
			return next();
		}
		res.redirect(301, `https://${req.hostname}${req.url}`);
	};
}

function setupMiddleware(app: _express.Application) {
	app.use(compression());
	app.use(AUTH_PATH, cookieParser());

	const JSON_REGEXP = /^application\/(([\w!//\$%&\*`\-\.\^~]*\+)?json|csp-report)/i;
	const isJson: bodyParser.Options['type'] = req => {
		const contentType = req.headers['content-type'];
		if (contentType == null) {
			return false;
		}
		return JSON_REGEXP.test(contentType);
	};

	app.use(bodyParser.json({ type: isJson, limit: '512kb' }));
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(methodOverride());
	app.use(passport.initialize());
	app.use(AUTH_PATH, cookieSession({ secret: COOKIE_SESSION_SECRET }));

	app.use(jwt.middleware);
}

function startServer(
	app: _express.Application,
	port: string | number,
): Promise<Server> {
	let server: Server;
	return Promise.fromCallback(cb => {
		server = app.listen(port, cb);
	}).then(() => {
		console.log(`Server listening in ${app.get('env')} mode on port ${port}`);
		return server;
	});
}

function runCommand(
	app: _express.Application,
	cmd: string,
	argv: string[],
): Promise<void> {
	const script = require(path.join(__dirname, 'commands', cmd));
	return script.execute(app, argv).then(() => {
		process.exit(0);
	});
}

function runFromCommandLine(app: _express.Application): Promise<void> {
	const cmd = process.argv[2];
	const args = process.argv.slice(3);
	return runCommand(app, cmd, args);
}
