import type { RequestHandler } from 'express';
import * as _ from 'lodash';
import { retrieveAPIKey } from '../../platform/api-keys';
import { getUser, reqHasPermission } from '../../platform/auth';

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
		await retrieveAPIKey(req);
		// We move the apiKey to the prefetchApiKey and delete it, so that it will only
		// be used if the full `apiKeyMiddleware` is later used
		req.prefetchApiKey = req.apiKey;
		delete req.apiKey;
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
