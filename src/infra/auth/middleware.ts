import type { RequestHandler } from 'express';
import { checkSudoValidity } from './jwt';

import { getAPIKey } from './api-keys';
import { getUser, reqHasPermission } from './auth';

export const authenticatedMiddleware: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		await getUser(req, false);
		if (req.creds) {
			next();
			return null;
		} else {
			res.sendStatus(401);
		}
	} catch {
		res.sendStatus(401);
	}
};

export const authorizedMiddleware: RequestHandler = async (req, res, next) => {
	try {
		await getUser(req);
		next();
		return null;
	} catch {
		res.sendStatus(401);
	}
};

export const identifyMiddleware: RequestHandler = async (req, _res, next) => {
	await getUser(req, false);
	next();
	return null;
};

export const prefetchApiKeyMiddleware: RequestHandler = async (
	req,
	_res,
	next,
) => {
	if (req.apiKey) {
		// If the api key is already set then we just reuse that and keep it
		if (!req.prefetchApiKey) {
			req.prefetchApiKey = req.apiKey;
		}
		return next();
	}
	try {
		// Note: this won't reply with 401 if there's no api key
		req.prefetchApiKey = await getAPIKey(req);
		next();
	} catch (err) {
		next(err);
	}
};

export const apiKeyMiddleware: RequestHandler = (req, _res, next) => {
	// Note: this won't reply with 401 if there's no api key
	if (req.prefetchApiKey && !req.apiKey) {
		req.apiKey = req.prefetchApiKey;
	}
	return next();
};

export const permissionRequiredMiddleware = (
	permission: string,
): RequestHandler => (req, res, next) => {
	if (reqHasPermission(req, permission)) {
		next();
		return null;
	} else {
		res.sendStatus(401);
	}
};

export const sudoMiddleware: RequestHandler = async (req, res, next) => {
	try {
		const user = await getUser(req, false);
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
