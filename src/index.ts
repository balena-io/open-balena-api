import * as Bluebird from 'bluebird';
import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import cookieSession = require('cookie-session');
import type { Application, Handler } from 'express';
import type { Server } from 'http';
import * as _ from 'lodash';
import * as methodOverride from 'method-override';
import * as passport from 'passport';
import * as path from 'path';
import * as Raven from 'raven';

import * as pine from '@resin/pinejs';

import type { User as DbUser } from './models';
import type { defaultFindUser$select } from './platform/auth';
import * as jwt from './platform/jwt';
passport.use(jwt.strategy);

import * as deviceOnlineState from './lib/device-online-state';

import {
	API_HOST,
	COOKIE_SESSION_SECRET,
	DB_POOL_SIZE,
	NODE_ENV,
	SENTRY_DSN,
} from './lib/config';

import * as _applicationRoutes from './routes/applications';

export const AUTH_PATH = '/auth';

export type SetupFunction = (app: Application) => void | PromiseLike<void>;

export interface SetupOptions {
	config: Parameters<typeof pine.init>[1]; // must be absolute or relative to `process.cwd()`
	version?: string; // this will be reported along with exceptions to Sentry
	skipHttpsPaths?: string[]; // a list of paths which should be exempt from https redirection

	onInit?: SetupFunction;
	onInitMiddleware?: SetupFunction;
	onInitModel?: SetupFunction;
	onInitHooks?: SetupFunction;
	onInitRoutes?: SetupFunction;

	onLogin?: (
		user: Pick<DbUser, typeof defaultFindUser$select[number]>,
	) => PromiseLike<void> | void;
}

export async function setup(app: Application, options: SetupOptions) {
	if (DB_POOL_SIZE != null) {
		pine.env.db.poolSize = DB_POOL_SIZE;
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
			'Content-Type, Authorization, Application-Record-Count, MaxDataServiceVersion, X-Requested-With, X-Balena-Client',
		);
		res.header('Access-Control-Allow-Credentials', 'true');
		res.header('Access-Control-Max-Age', '86400');
		next();
	});

	app.use('/ping', (_req, res) => {
		res.sendStatus(200);
	});

	await options.onInit?.(app);

	await setupMiddleware(app);
	await options.onInitMiddleware?.(app);

	await pine.init(app, options.config);
	await options.onInitModel?.(app);

	await import('./hooks');
	await options.onInitHooks?.(app);

	const routes = await import('./routes');
	routes.setup(app, options.onLogin);
	await options.onInitRoutes?.(app);

	app.use(Raven.errorHandler());

	// start consuming the API heartbeat state queue...
	deviceOnlineState.getInstance().start();

	return {
		app,
		startServer: _.partial(startServer, app),
		runCommand: _.partial(runCommand, app),
		runFromCommandLine: _.partial(runFromCommandLine, app),
	};
}

function fixProtocolMiddleware(skipUrls: string[] = []): Handler {
	return (req, res, next) => {
		if (req.protocol === 'https' || skipUrls.includes(req.url)) {
			return next();
		}
		res.redirect(301, `https://${API_HOST}${req.url}`);
	};
}

function setupMiddleware(app: Application) {
	app.use(compression());
	app.use(AUTH_PATH, cookieParser());

	const JSON_REGEXP = /^application\/(([\w!//\$%&\*`\-\.\^~]*\+)?json|csp-report)/i;
	const isJson: bodyParser.Options['type'] = (req) => {
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

	app.use(
		async (
			req,
			res,
			next, // Only import on demand to avoid issues with import ordering
		) => {
			const { prefetchApiKeyMiddleware } = await import(
				'./platform/middleware'
			);
			prefetchApiKeyMiddleware(req, res, next);
		},
	);
}

async function startServer(
	app: Application,
	port: string | number,
): Promise<Server> {
	let server: Server;
	await Bluebird.fromCallback((cb) => {
		server = app.listen(port, cb as (...args: any[]) => void);
	});
	console.log(`Server listening in ${app.get('env')} mode on port ${port}`);
	return server!;
}

async function runCommand(
	app: Application,
	cmd: string,
	argv: string[],
): Promise<void> {
	const script = require(path.join(__dirname, 'commands', cmd));
	await script.execute(app, argv);
	process.exit(0);
}

function runFromCommandLine(app: Application): Promise<void> {
	const cmd = process.argv[2];
	const args = process.argv.slice(3);
	return runCommand(app, cmd, args);
}
