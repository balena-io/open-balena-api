import Bluebird from 'bluebird';
import bodyParser from 'body-parser';
import compression from 'compression-next';
import compressible from 'compressible';
import cookieParser from 'cookie-parser';
import cookieSession from 'cookie-session';
import type { Application, Handler, Request } from 'express';
import type { Server } from 'http';
import _ from 'lodash';
import methodOverride from 'method-override';
import passport from 'passport';
import path from 'path';
import * as Sentry from '@sentry/node';
import * as zlib from 'node:zlib';

import * as pine from '@balena/pinejs';

import type { PickDeferred, User as DbUser } from './balena-model';
import type { defaultFindUser$select } from './infra/auth/auth';
import * as jwt from './infra/auth/jwt-passport';

const { api } = pine.sbvrUtils;

// TODO: Move this into a feature
passport.use(
	jwt.createStrategy(
		async (id: number) =>
			(await api.resin.get({
				resource: 'user',
				id,
				passthrough: { req: pine.permissions.root },
				options: {
					$select: ['actor', 'jwt_secret'],
				},
			})) as PickDeferred<DbUser, 'actor' | 'jwt_secret'>,
	),
);

import {
	API_HOST,
	COOKIE_SESSION_SECRET,
	DB_POOL_SIZE,
	DB_STATEMENT_TIMEOUT,
	DB_QUERY_TIMEOUT,
	NODE_ENV,
	SENTRY_DSN,
	HIDE_UNVERSIONED_ENDPOINT,
	setVersion,
	NDJSON_CTYPE,
	BROTLI_COMPRESSION_QUALITY,
	GZIP_COMPRESSION_QUALITY,
	BROTLI_COMPRESSION_WINDOW_BITS,
} from './lib/config';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from './infra/error-handling';
import {
	findUser,
	getUser,
	reqHasPermission,
	userFields,
	userHasPermission,
	comparePassword,
	registerUser,
	setPassword,
	GetNewUserRoleFunction,
	setRegistrationRoleFunc,
	validatePassword,
	checkUserPassword,
} from './infra/auth/auth';
import {
	setUserTokenDataCallback,
	tokenFields,
	generateNewJwtSecret,
	loginUserXHR,
	updateUserXHR,
	createSessionToken,
} from './infra/auth/jwt';
import {
	createAllPermissions,
	setApiKey,
	getOrInsertPermissionId,
	assignRolePermission,
	getOrInsertRoleId,
	assignUserPermission,
	assignUserRole,
} from './infra/auth/permissions';
import { createScopedAccessToken, createJwt } from './infra/auth/jwt';
import { resolveOrGracefullyDenyDevices } from './features/device-state/middleware';
import {
	authenticatedMiddleware,
	authorizedMiddleware,
	apiKeyMiddleware,
	identifyMiddleware,
	permissionRequiredMiddleware,
	prefetchApiKeyMiddleware,
	sudoMiddleware,
} from './infra/auth';
import { isApiKeyWithRole } from './features/api-keys/lib';
import { setupDeleteCascade as addDeleteHookForDependents } from './features/cascade-delete/setup-delete-cascade';
import {
	updateOrInsertModel,
	getOrInsertModelId,
} from './infra/pinejs-client-helpers';
import {
	loginRateLimiter,
	normalizeHandle,
	refreshToken,
} from './features/auth';
import { getIP, getIPv4, isValidInteger, throttledForEach } from './lib/utils';
import {
	createRateLimitMiddleware,
	createRateLimiter,
	getUserIDFromCreds,
} from './infra/rate-limiting';
import {
	getAccessibleDeviceTypes,
	findBySlug,
	getDeviceTypeBySlug,
} from './features/device-types/device-types';
import { proxy as supervisorProxy } from './features/device-proxy/device-proxy';
import { generateConfig } from './features/device-config/device-config';
import {
	DeviceOnlineStates,
	getPollInterval,
	getInstance as getDeviceOnlineStateManager,
} from './features/device-heartbeat';
import { registryAuth } from './features/registry/certs';
import {
	ALLOWED_NAMES,
	BLOCKED_NAMES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
} from './features/vars-schema/env-vars';
import * as baseAuth from './lib/auth';
// TODO: This should not be exported
import { varListInsert } from './features/device-state/state-get-utils';
import {
	GetUrlFunction,
	setupRequestLogging,
	skipLogging,
} from './features/request-logging';
import {
	startContractSynchronization,
	setSyncSettings,
} from './features/contracts';

import { addToModel as addUserHasDirectAccessToApplicationToModel } from './features/applications/models/user__has_direct_access_to__application';
import { getApplicationSlug } from './features/applications';
import * as deviceAdditions from './features/devices/models/device-additions';
import { addToModel as addReleaseAdditionsToModel } from './features/ci-cd/models/release-additions';
import { apiRoot } from './balena';

export * as tags from './features/tags/validation';

export type { Creds, User } from './infra/auth/jwt-passport';
export type { Access } from './features/registry/registry';
export type { ApplicationType } from './features/application-types/application-types';
export type { DeviceTypeJson } from './features/device-types/device-type-json';

export { DefaultApplicationType } from './features/application-types/application-types';
export * as request from './infra/request-promise';
export * as redis from './infra/redis';
export * as scheduler from './infra/scheduler';
export * as cache from './infra/cache';
export * as config from './lib/config';
export * as abstractSql from './abstract-sql-utils';

export * as deviceState from './features/device-state';
export const errors = { captureException, handleHttpErrors, translateError };
export const auth = {
	...baseAuth,
	findUser,
	getUser,
	reqHasPermission,
	setUserTokenDataCallback,
	tokenFields,
	userFields,
	userHasPermission,
	comparePassword,
	generateNewJwtSecret,
	loginUserXHR,
	registerUser,
	setPassword,
	updateUserXHR,
	validatePassword,
	checkUserPassword,
	createSessionToken,
	createScopedAccessToken,
	createJwt,
	createAllPermissions,
	setApiKey,
	getOrInsertPermissionId,
	assignRolePermission,
	getOrInsertRoleId,
	assignUserPermission,
	assignUserRole,
	getUserIDFromCreds,
	registryAuth,
	normalizeHandle,
	/** @deprecated Will be removed in a future version */
	refreshToken,
};
export const rateLimiting = {
	createRateLimitMiddleware,
	createRateLimiter,
};
export const middleware = {
	sudoMiddleware,
	authenticated: authenticatedMiddleware,
	authorized: authorizedMiddleware,
	apiKeyMiddleware,
	resolveOrGracefullyDenyDevices,
	identify: identifyMiddleware,
	permissionRequired: permissionRequiredMiddleware,
	loginRateLimiter,
	skipLogging,
};
export const hooks = {
	addDeleteHookForDependents,
};
export const utils = {
	updateOrInsertModel,
	getOrInsertModelId,
	getIP,
	getIPv4,
	isValidInteger,
	varListInsert,
	throttledForEach,
};
export const apiKeys = {
	isApiKeyWithRole,
};
export const application = {
	addUserHasDirectAccessToApplicationToModel,
	getApplicationSlug,
};
export const device = {
	addVirtualFieldsToModel: deviceAdditions.addToModel,
	supervisorProxy,
	generateConfig,
	getPollInterval,
	DeviceOnlineStates,
	getDeviceOnlineStateManager,
};
export const release = {
	addVirtualFieldsToModel: addReleaseAdditionsToModel,
};
export const deviceTypes = {
	getAccessibleDeviceTypes,
	findBySlug,
	getDeviceTypeBySlug,
};
export const contracts = {
	setSyncSettings,
};
export const envVarsConfig = {
	ALLOWED_NAMES,
	BLOCKED_NAMES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
};

export const AUTH_PATH = '/auth';

export type SetupFunction = (app: Application) => void | PromiseLike<void>;

export interface SetupOptions {
	config: Parameters<typeof pine.init>[1]; // must be absolute or relative to `process.cwd()`
	databaseOptions?: Parameters<typeof pine.init>[2];
	version: string; // this will be reported along with exceptions to Sentry and is also used for caching
	skipHttpsPaths?: string[]; // a list of paths which should be exempt from https redirection

	getUrl: GetUrlFunction;
	onInit?: SetupFunction;
	onInitMiddleware?: SetupFunction;
	onInitModel?: SetupFunction;
	onInitHooks?: SetupFunction;
	onInitRoutes?: SetupFunction;

	onLogin?: (
		user: Pick<DbUser, typeof defaultFindUser$select[number]>,
		tx: Tx,
	) => PromiseLike<void> | void;
	onLogWriteStreamInitialized?: (req: Request) => void;
	onLogReadStreamInitialized?: (req: Request) => void;

	getNewUserRole?: GetNewUserRoleFunction;
}

export async function setup(app: Application, options: SetupOptions) {
	setVersion(options.version);
	if (DB_POOL_SIZE != null) {
		pine.env.db.poolSize = DB_POOL_SIZE;
	}
	if (DB_STATEMENT_TIMEOUT != null) {
		pine.env.db.statementTimeout = DB_STATEMENT_TIMEOUT;
	}
	if (DB_QUERY_TIMEOUT != null) {
		pine.env.db.queryTimeout = DB_QUERY_TIMEOUT;
	}

	app.disable('x-powered-by');

	app.use('/connectivity-check', (_req, res) => {
		res.status(204);
		// Remove some automatically added headers, we want the response to be as small as possible
		res.removeHeader('ETag');
		res.end();
	});

	if (SENTRY_DSN != null) {
		Sentry.init({
			dsn: SENTRY_DSN,
			release: options.version,
			environment: NODE_ENV,
		});
	}

	// redirect to https if needed, except for requests to
	// the /ping endpoint which must always return 200
	app.use(
		fixProtocolMiddleware(['/ping'].concat(options.skipHttpsPaths || [])),
	);

	app.use((req, res, next) => {
		const userAgent = req.get('User-Agent');
		if (!userAgent || /^Supervisor|^curl/.test(userAgent)) {
			// The supervisor either sends no user-agent or, more recently, identifies
			// itself as "Supervisor/X.X.X (Linux; Resin OS X.X.X; prod)" and the
			// cron-updater uses curl, all of which ignore CORS and other browser related
			// headers, so we can drop them to save bandwidth.
			return next();
		}
		res.set('X-Frame-Options', 'DENY');
		res.set('X-Content-Type-Options', 'nosniff');

		const origin = req.get('Origin') || '*';
		res.header('Access-Control-Allow-Origin', origin);
		res.header('Access-Control-Allow-Credentials', 'true');

		if (req.method !== 'OPTIONS') {
			// If we're not a preflight request then carry on to the real implementation
			return next();
		}
		// Otherwise add the preflight CORS headers and return 200
		res.header(
			'Access-Control-Allow-Methods',
			'GET, PUT, POST, PATCH, DELETE, OPTIONS, HEAD',
		);
		res.header(
			'Access-Control-Allow-Headers',
			'Content-Type, Authorization, Application-Record-Count, MaxDataServiceVersion, X-Requested-With, X-Balena-Client',
		);
		res.header('Access-Control-Max-Age', '86400');
		res.status(200).end();
	});

	app.use('/ping', (_req, res) => {
		res.sendStatus(200);
	});

	if (HIDE_UNVERSIONED_ENDPOINT) {
		app.use(`/${apiRoot}/*`, (_req, res) => {
			res.status(404).end();
		});
	}

	setupRequestLogging(app, options.getUrl);

	await options.onInit?.(app);

	await setupMiddleware(app);
	await options.onInitMiddleware?.(app);

	await pine.init(app, options.config, options.databaseOptions);
	await options.onInitModel?.(app);

	if (options.getNewUserRole) {
		setRegistrationRoleFunc(options.getNewUserRole);
	}

	await import('./hooks');
	await options.onInitHooks?.(app);

	const routes = await import('./routes');
	routes.setup(app, options);
	await options.onInitRoutes?.(app);

	app.use(Sentry.Handlers.errorHandler());

	// start consuming the API heartbeat state queue...
	getDeviceOnlineStateManager().start();

	startContractSynchronization();

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
		if (req.headers['x-forwarded-for'] == null) {
			const trust = req.app.get('trust proxy fn') as ReturnType<
				typeof import('proxy-addr').compile
			>;
			if (trust(req.socket.remoteAddress!, 0)) {
				// If we trust the origin of the request and they have not set any `x-forwarded-for` header then
				// allow them to use http connections without needing to set a dummy `x-forwarded-proto` header
				return next();
			}
		}
		res.redirect(301, `https://${API_HOST}${req.url}`);
	};
}

function setupMiddleware(app: Application) {
	app.use(
		compression({
			level: GZIP_COMPRESSION_QUALITY,
			params: {
				[zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_COMPRESSION_QUALITY,
				[zlib.constants.BROTLI_PARAM_LGWIN]:
					BROTLI_COMPRESSION_WINDOW_BITS ??
					zlib.constants.BROTLI_DEFAULT_WINDOW,
			},
			// We use a custom filter so that we can explicitly enable compression for ndjson (ie logs)
			filter(_req, res) {
				const type = res.getHeader('Content-Type') as string;

				return (
					type !== undefined &&
					(type === NDJSON_CTYPE || compressible(type) === true)
				);
			},
		}),
	);
	app.use(AUTH_PATH, cookieParser());

	const JSON_REGEXP =
		/^application\/(([\w!//\$%&\*`\-\.\^~]*\+)?json|csp-report)/i;
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

	app.use(prefetchApiKeyMiddleware);
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
