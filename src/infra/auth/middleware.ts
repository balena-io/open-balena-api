import type { RequestHandler } from 'express';
import { checkSudoValidity } from './jwt';

import { prefetchAPIKey, retrieveAPIKey } from './api-keys';
import { getUser, reqHasPermission } from './auth';

/**
 * This checks that a user has provided credentials, they may not be fully authorized, ie they may still need to pass 2fa
 * Note: This is specifically *user* credentials, device keys/application provisioning keys do not count
 */
export const authenticatedMiddleware: RequestHandler = async (
	req,
	res,
	next,
) => {
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
};

/**
 * This checks that a user has provided authorized credentials, ie they have passed any required 2fa checks
 * Note: This is specifically *user* credentials, device keys/application provisioning keys do not count
 */
export const authorizedMiddleware: RequestHandler = async (req, res, next) => {
	try {
		await getUser(req, undefined);
		next();
		return null;
	} catch {
		res.status(401).end();
	}
};

/**
 * This resolves any provided credentials, with no checks on the actor or 2fa status
 */
export const identifyMiddleware: RequestHandler = async (req, _res, next) => {
	await getUser(req, undefined, false);
	next();
	return null;
};

/**
 * This starts a prefetch of api key permissions without waiting for them to finish resolving
 */
export const prefetchApiKeyMiddleware: RequestHandler = (req, _res, next) => {
	prefetchAPIKey(req, undefined);
	next();
};

/**
 * This resolves api key permissions, making use of the prefetch if it exists or otherwise starting a fetch from scratch
 */
export const apiKeyMiddleware: RequestHandler = async (req, _res, next) => {
	try {
		// Note: this won't reply with 401 if there's no api key
		await retrieveAPIKey(req, undefined);
		next();
	} catch (err) {
		next(err);
	}
};

/**
 * This creates a middleware that checks a specific permission is present on the request
 *
 * @param permission The required permission
 * @returns The middleware to check the permission
 */
export const permissionRequiredMiddleware =
	(permission: string): RequestHandler =>
	(req, res, next) => {
		if (reqHasPermission(req, permission)) {
			next();
			return null;
		} else {
			res.status(401).end();
		}
	};

/**
 * This checks that a user has authenticated recently and therefore can perform privileged operations
 * Note: This is specifically *user* credentials, device keys/application provisioning keys do not count
 */
export const sudoMiddleware: RequestHandler = async (req, res, next) => {
	try {
		const user = await getUser(req, undefined, false);
		if (user != null && (await checkSudoValidity(user))) {
			next();
			return;
		} else {
			res.status(401).json({ error: 'Fresh authentication token required' });
		}
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};
