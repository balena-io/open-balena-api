/// <reference path="./typings/index.ts" />

import bodyParser from 'body-parser';
import compression from 'compression';
import compressible from 'compressible';
import cookieParser from 'cookie-parser';
import cookieSession from 'cookie-session';
import type { Application, Handler, Request } from 'express';
import type { Server } from 'http';
import _ from 'lodash';
import passport from 'passport';
import * as Sentry from '@sentry/node';
import * as zlib from 'node:zlib';

import * as pine from '@balena/pinejs';
import { sbvrUtils } from '@balena/pinejs';

import type { User } from './balena-model.js';
import type {
	defaultFindUser$select,
	GetNewUserRoleFunction,
} from './infra/auth/auth.js';
import * as jwt from './infra/auth/jwt-passport.js';

const { api } = sbvrUtils;

// TODO: Move this into a feature
passport.use(
	jwt.createStrategy(
		async (id: number) =>
			await api.resin.get({
				resource: 'user',
				id,
				passthrough: { req: pine.permissions.root },
				options: {
					$select: ['actor', 'jwt_secret'],
				},
			}),
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
	ASYNC_TASKS_ENABLED,
	PINEJS_QUEUE_INTERVAL_MS,
	PINEJS_QUEUE_CONCURRENCY,
	DB_PREPARE_AFTER_N,
	PINEJS_WEBRESOURCE_MULTIPART_ENABLED,
} from './lib/config.js';

import {
	captureException,
	handleHttpErrors,
	ThisShouldNeverHappenError,
	translateError,
} from './infra/error-handling/index.js';
import {
	findUser,
	getUser,
	reqHasPermission,
	userFields,
	userHasPermission,
	comparePassword,
	registerUser,
	setPassword,
	setRegistrationRoleFunc,
	validatePassword,
	checkUserPassword,
} from './infra/auth/auth.js';
import {
	setUserTokenDataCallback,
	tokenFields,
	generateNewJwtSecret,
	loginUserXHR,
	updateUserXHR,
	createSessionToken,
} from './infra/auth/jwt.js';
import {
	createAllPermissions,
	setApiKey,
	getOrInsertPermissionId,
	assignRolePermission,
	getOrInsertRoleId,
	assignUserPermission,
	assignUserRole,
	revokeUserRole,
} from './infra/auth/permissions.js';
import { createScopedAccessToken, createJwt } from './infra/auth/jwt.js';
import { middleware as authMiddleware } from './infra/auth/index.js';
import {
	augmentReqApiKeyPermissions,
	isApiKeyWithRole,
	getApiKeyOptsFromRequest,
} from './features/api-keys/lib.js';
import { setupDeleteCascade as addDeleteHookForDependents } from './features/cascade-delete/setup-delete-cascade.js';
import { addHooksForFieldSizeLimitChecks } from './features/field-size-limits/setup-field-size-limits.js';
import {
	updateOrInsertModel,
	getOrInsertModelId,
} from './infra/pinejs-client-helpers/index.js';
import {
	normalizeHandle,
	refreshToken,
	publicKeys,
} from './features/auth/index.js';
import {
	getIP,
	getIPv4,
	isValidInteger,
	throttledForEach,
	getBodyOrQueryParam,
} from './lib/utils.js';
import {
	createRateLimitMiddleware,
	createRateLimiter,
	getUserIDFromCreds,
} from './infra/rate-limiting/index.js';
import {
	getAccessibleDeviceTypeJsons,
	getDeviceTypeJsonBySlug,
	getDeviceTypeBySlug,
} from './features/device-types/device-types.js';
import { proxy as supervisorProxy } from './features/device-proxy/device-proxy.js';
import { generateConfig } from './features/device-config/device-config.js';
import {
	DeviceOnlineStates,
	getPollInterval,
	getInstance as getDeviceOnlineStateManager,
} from './features/device-heartbeat/index.js';
import { registryAuth } from './features/registry/certs.js';
import {
	ALLOWED_NAMES,
	BLOCKED_NAMES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
} from './features/vars-schema/env-vars.js';
import * as baseAuth from './lib/auth.js';
// TODO: This should not be exported
import { varListInsert } from './features/device-state/state-get-utils.js';
import type { GetUrlFunction } from './features/request-logging/index.js';
import { setupRequestLogging } from './features/request-logging/index.js';
import { startContractSynchronization } from './features/contracts/index.js';
import {
	defaultRespondFn,
	setRespondFn,
} from './features/device-state/middleware.js';

import { addToModel as addUserHasDirectAccessToApplicationToModel } from './features/applications/models/user__has_direct_access_to__application.js';
import { getApplicationSlug } from './features/applications/index.js';
import * as deviceAdditions from './features/devices/models/device-additions.js';
import { addToModel as addReleaseAdditionsToModel } from './features/ci-cd/models/release-additions.js';
import { model as balenaModel } from './balena.js';
import { getV6Translations } from './translations/v6/v6.js';
import { getV7Translations } from './translations/v7/v7.js';

export * as tags from './features/tags/validation.js';
export type { TokenUserPayload } from './infra/auth/jwt.js';
export type { Creds, ResolvedUserPayload } from './infra/auth/jwt-passport.js';
export type { Access } from './features/registry/registry.js';
export type { ApplicationType } from './features/application-types/application-types.js';
export type { DeviceTypeJson } from './features/device-types/device-type-json.js';

export type { DefaultApplicationType } from './features/application-types/application-types.js';
export * as request from './infra/request-promise/index.js';
export * as redis from './infra/redis/index.js';
export * as scheduler from './infra/scheduler/index.js';
export * as cache from './infra/cache/index.js';
export * as config from './lib/config.js';
export * as abstractSql from './abstract-sql-utils.js';
export { getFileUploadHandler } from './fileupload-handler.js';

export * as deviceState from './features/device-state/index.js';
export const errors = {
	captureException,
	handleHttpErrors,
	ThisShouldNeverHappenError,
	translateError,
};
export const deletedFrozenDevices = {
	defaultRespondFn,
	setRespondFn,
};
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
	revokeUserRole,
	getUserIDFromCreds,
	registryAuth,
	normalizeHandle,
	publicKeys,
	/** @deprecated Will be removed in a future version */
	refreshToken,
};
export const rateLimiting = {
	createRateLimitMiddleware,
	createRateLimiter,
};
export * as middleware from './exports/middleware.js';
export const hooks = {
	addDeleteHookForDependents,
	addHooksForFieldSizeLimitChecks,
};
export const utils = {
	updateOrInsertModel,
	getOrInsertModelId,
	getIP,
	getIPv4,
	isValidInteger,
	varListInsert,
	throttledForEach,
	getBodyOrQueryParam,
};
export const apiKeys = {
	augmentReqApiKeyPermissions,
	isApiKeyWithRole,
	getApiKeyOptsFromRequest,
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
	// TODO: Drop me in the next major
	/** @deprecated Use getAccessibleDeviceTypeJsons */
	getAccessibleDeviceTypes: getAccessibleDeviceTypeJsons,
	getAccessibleDeviceTypeJsons,
	// TODO: Drop me in the next major
	/** @deprecated Use getDeviceTypeJsonBySlug */
	findBySlug: getDeviceTypeJsonBySlug,
	getDeviceTypeJsonBySlug,
	getDeviceTypeBySlug,
};
export * as contracts from './exports/contracts.js';
export const envVarsConfig = {
	ALLOWED_NAMES,
	BLOCKED_NAMES,
	SUPERVISOR_CONFIG_VAR_PROPERTIES,
	DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES,
};

// Needed so that the augmented `@balena/sbvr-types` typings
// automatically become available to consumer projects.
import './translations/v6/numeric-big-integer-hack.js';

export const translations = {
	v7: {
		getTranslations: getV7Translations,
		loadHooks: () => import('./translations/v7/hooks.js'),
	},
	v6: {
		getTranslations: getV6Translations,
		loadHooks: () => import('./translations/v6/hooks.js'),
	},
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
	onInitTasks?: SetupFunction;

	onLogin?: (
		user: Pick<User['Read'], (typeof defaultFindUser$select)[number]>,
		tx: Tx,
		req: Request,
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
	pine.env.db.prepareAfterN = DB_PREPARE_AFTER_N;

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
			integrations: [
				Sentry.httpIntegration({
					ignoreIncomingRequests(url) {
						return /^\/(:ping|connectivity-check|csp-report|config\/vars)/.test(
							url,
						);
					},
					ignoreIncomingRequestBody(url) {
						return /^\/device\/v2\/.*\/log-stream/.test(url);
					},
				}),
			],
		});
	}

	// redirect to https if needed, except for requests to
	// the /ping endpoint which must always return 200
	app.use(
		fixProtocolMiddleware(['/ping'].concat(options.skipHttpsPaths ?? [])),
	);

	app.use((req, res, next) => {
		const userAgent = req.get('User-Agent');
		if (!userAgent || /^Supervisor|^curl/.test(userAgent)) {
			// The supervisor either sends no user-agent or, more recently, identifies
			// itself as "Supervisor/X.X.X (Linux; Resin OS X.X.X; prod)" and the
			// cron-updater uses curl, all of which ignore CORS and other browser related
			// headers, so we can drop them to save bandwidth.
			next();
			return;
		}
		res.set('X-Frame-Options', 'DENY');
		res.set('X-Content-Type-Options', 'nosniff');

		const origin = req.get('Origin') ?? '*';
		res.header('Access-Control-Allow-Origin', origin);
		res.header('Access-Control-Allow-Credentials', 'true');
		// Indicates the response headers that should be made available to js code running in browsers,
		// on top of the default CORS-safelisted ones.
		res.header('Access-Control-Expose-Headers', 'Retry-After');

		if (req.method !== 'OPTIONS') {
			// If we're not a preflight request then carry on to the real implementation
			next();
			return;
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
		app.use(`/${balenaModel.apiRoot}/*`, (_req, res) => {
			res.status(404).end();
		});
	}

	setupRequestLogging(app, options.getUrl);

	await options.onInit?.(app);

	setupMiddleware(app);
	await options.onInitMiddleware?.(app);

	await pine.init(app, options.config, options.databaseOptions);
	await options.onInitModel?.(app);

	if (options.getNewUserRole) {
		setRegistrationRoleFunc(options.getNewUserRole);
	}

	await import('./hooks.js');
	await options.onInitHooks?.(app);

	if (ASYNC_TASKS_ENABLED) {
		pine.env.tasks.queueConcurrency = PINEJS_QUEUE_CONCURRENCY;
		pine.env.tasks.queueIntervalMS = PINEJS_QUEUE_INTERVAL_MS;
		await import('./tasks.js');
		await options.onInitTasks?.(app);
		pine.tasks.worker?.start();
	}

	pine.env.webResource.multipartUploadEnabled =
		PINEJS_WEBRESOURCE_MULTIPART_ENABLED;

	const routes = await import('./routes.js');
	routes.setup(app, options);
	await options.onInitRoutes?.(app);

	Sentry.setupExpressErrorHandler(app);

	// start consuming the API heartbeat state queue...
	getDeviceOnlineStateManager().start();

	startContractSynchronization();

	return {
		app,
		startServer: _.partial(startServer, app),
	};
}

function fixProtocolMiddleware(skipUrls: string[] = []): Handler {
	return (req, res, next) => {
		if (req.protocol === 'https' || skipUrls.includes(req.url)) {
			next();
			return;
		}
		if (req.headers['x-forwarded-for'] == null) {
			const trust = req.app.get('trust proxy fn') as ReturnType<
				typeof import('proxy-addr').compile
			>;
			if (req.socket.remoteAddress && trust(req.socket.remoteAddress, 0)) {
				// If we trust the origin of the request and they have not set any `x-forwarded-for` header then
				// allow them to use http connections without needing to set a dummy `x-forwarded-proto` header
				next();
				return;
			}
		}
		res.redirect(301, `https://${API_HOST}${req.url}`);
	};
}

function setupMiddleware(app: Application) {
	app.use(authMiddleware.prefetchApiKey);

	app.use(
		compression({
			level: GZIP_COMPRESSION_QUALITY,
			brotli: {
				params: {
					[zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_COMPRESSION_QUALITY,
					[zlib.constants.BROTLI_PARAM_LGWIN]:
						BROTLI_COMPRESSION_WINDOW_BITS ??
						zlib.constants.BROTLI_DEFAULT_WINDOW,
				},
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

	const JSON_REGEXP = /^application\/(([\w!//$%&*`\-.^~]*\+)?json|csp-report)/i;
	const isJson: bodyParser.Options['type'] = (req) => {
		const contentType = req.headers['content-type'];
		if (contentType == null) {
			return false;
		}
		return JSON_REGEXP.test(contentType);
	};

	app.use(bodyParser.json({ type: isJson, limit: '512kb' }));
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use((req, _res, next) => {
		// Ensure req.body is always defined to match body-parser v1 / express v4 behavior
		// TODO: Remove the reliance on req.body always being defined
		req.body ??= {};
		next();
	});
	app.use(passport.initialize());
	app.use(AUTH_PATH, cookieSession({ secret: COOKIE_SESSION_SECRET }));

	app.use(jwt.middleware);
}

async function startServer(
	app: Application,
	port: string | number,
): Promise<Server> {
	let server: Server;
	// empty 404 error for undefined paths to avoid
	// express creates default 404 error with html body
	app.use((_request, response) => {
		response.status(404).end();
	});
	await new Promise<void>((resolve) => {
		server = app.listen(port, resolve);
	});
	console.log(`Server listening in ${app.get('env')} mode on port ${port}`);
	return server!;
}
