import { checkSudoValidity } from './jwt.ts';

import { prefetchAPIKey, retrieveAPIKey } from './api-keys.ts';
import { getUser, reqHasPermission } from './auth.ts';
import { createUnvalidatedRequestHandler } from '../validation/index.ts';

/**
 * This checks that a user has provided credentials, they may not be fully authorized, ie they may still need to pass 2fa
 * Note: This is specifically *user* credentials, device keys/application provisioning keys do not count
 */
export const partiallyAuthenticatedUser = createUnvalidatedRequestHandler(
	async (req, res, next) => {
		try {
			await getUser(req, undefined, false);
			if (req.creds) {
				next();
			} else {
				res.status(401).end();
			}
		} catch {
			res.status(401).end();
		}
	},
);

/**
 * This checks that a user has provided authorized credentials, ie they have passed any required 2fa checks
 * Note: This is specifically *user* credentials, device keys/application provisioning keys do not count
 */
export const fullyAuthenticatedUser = createUnvalidatedRequestHandler(
	async (req, res, next) => {
		try {
			await getUser(req, undefined);
			next();
			return null;
		} catch {
			res.status(401).end();
		}
	},
);

/**
 * This resolves any provided credentials (api key or JWT), with no checks on the actor or 2fa status,
 * it will also resolve the user the credentials belong to if they are user credentials
 */
export const resolveCredentialsAndUser = createUnvalidatedRequestHandler(
	async (req, _res, next) => {
		await getUser(req, undefined, false);
		next();
		return null;
	},
);

/**
 * This starts a prefetch of api key permissions without waiting for them to finish resolving
 */
export const prefetchApiKey = createUnvalidatedRequestHandler(
	(req, _res, next) => {
		prefetchAPIKey(req, undefined);
		next();
	},
);

/**
 * This resolves api key permissions, making use of the prefetch if it exists or otherwise starting a fetch from scratch
 * Note: this won't reply with 401 if there's no api key
 */
export const resolveApiKey = createUnvalidatedRequestHandler(
	async (req, _res, next) => {
		try {
			await retrieveAPIKey(req, undefined);
			next();
		} catch (err) {
			next(err);
		}
	},
);

/**
 * This ensures that a valid api key has been passed, returning 401 if it has not
 */
export const authenticatedApiKey = createUnvalidatedRequestHandler(
	async (req, res, next) => {
		try {
			await retrieveAPIKey(req, undefined);
			if (req.apiKey) {
				next();
			} else {
				res.status(401).json({ error: 'API key required' });
			}
		} catch (err) {
			next(err);
		}
	},
);

/**
 * This ensures that a fully authorized JWT user or a valid api key has been passed, returning 401 if not.
 * Unlike `authenticated`, it doesn't look up the user that owns an api key. Use it for routes whose
 * handlers don't read `req.user`/`req.creds` for api keys. pinejs would ignore that user anyway, because
 * it has no `permissions`, and use `req.apiKey` (including its `actor`).
 */
export const authenticatedJwtOrApiKey = createUnvalidatedRequestHandler(
	async (req, res, next) => {
		try {
			if (req.user == null) {
				await retrieveAPIKey(req, undefined);
			}
			if (req.user != null || req.apiKey != null) {
				next();
			} else {
				res.status(401).end();
			}
		} catch (err) {
			next(err);
		}
	},
);

/**
 * This ensures that valid credentials have been passed, returning 401 if they have not
 * @deprecated
 */
export const authenticated = createUnvalidatedRequestHandler(
	async (req, res, next) => {
		try {
			await getUser(req, undefined);
			next();
			return null;
		} catch {
			if (req.apiKey) {
				next();
			} else {
				res.status(401).end();
			}
		}
	},
);

/**
 * This creates a middleware that checks a specific permission is present on the request
 *
 * @param permission The required permission
 * @returns The middleware to check the permission
 */
export const permissionRequired = (permission: string) =>
	createUnvalidatedRequestHandler((req, res, next) => {
		if (reqHasPermission(req, permission)) {
			next();
			return null;
		} else {
			res.status(401).end();
		}
	});

/**
 * This checks that a user has authenticated recently and therefore can perform privileged operations
 * Note: This is specifically *user* credentials, device keys/application provisioning keys do not count
 */
export const sudo = createUnvalidatedRequestHandler(async (req, res, next) => {
	try {
		const user = await getUser(req, undefined, false);
		if (user != null && checkSudoValidity(user)) {
			next();
			return;
		} else {
			res.status(401).json({ error: 'Fresh authentication token required' });
		}
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});
