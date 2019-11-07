import { reqHasPermission, getUser } from './auth';
import { retrieveAPIKey } from './api-keys';
import { RequestHandler } from 'express';

import { resinApi } from './index';
import { sbvrUtils } from '@resin/pinejs';

const { root } = sbvrUtils;

export const authenticated: RequestHandler = (req, res, next) =>
	getUser(req, false)
		.then(() => {
			if (req.creds) {
				next();
				return null;
			} else {
				res.sendStatus(401);
			}
		})
		.catch(() => {
			res.sendStatus(401);
		});

export const authorized: RequestHandler = (req, res, next) =>
	getUser(req)
		.then(() => {
			next();
			return null;
		})
		.catch(() => {
			res.sendStatus(401);
		});

export const identify: RequestHandler = (req, _res, next) =>
	getUser(req, false).then(() => {
		next();
		return null;
	});

export const prefetchApiKeyMiddleware: RequestHandler = (req, _res, next) => {
	if (req.apiKey) {
		// If the api key is already set then we just reuse that and keep it
		if (!req.prefetchApiKey) {
			req.prefetchApiKey = req.apiKey;
		}
		return next();
	}
	// Note: this won't reply with 401 if there's no api key
	return retrieveAPIKey(req)
		.then(() => {
			// We move the apiKey to the prefetchApiKey and delete it, so that it will only
			// be used if the full `apiKeyMiddleware` is later used
			req.prefetchApiKey = req.apiKey;
			delete req.apiKey;
		})
		.asCallback(next);
};

export const apiKeyMiddleware: RequestHandler = (req, _res, next) => {
	// Note: this won't reply with 401 if there's no api key
	if (req.prefetchApiKey && !req.apiKey) {
		req.apiKey = req.prefetchApiKey;
	}
	return next();
};

export const permissionRequired = (permission: string): RequestHandler => (
	req,
	res,
	next,
) => {
	if (reqHasPermission(req, permission)) {
		next();
		return null;
	} else {
		res.sendStatus(401);
	}
};

const checkDeviceExistsQuery = resinApi.prepare<{ uuid: string }>({
	resource: 'device/$count',
	passthrough: { req: root },
	options: {
		$filter: {
			uuid: { '@': 'uuid' },
		},
	},
});
export const gracefullyDenyDeletedDevices: RequestHandler = (
	req,
	res,
	next,
) => {
	const { uuid } = req.params;

	const returnCode = req.method === 'GET' ? 304 : 200;

	return checkDeviceExistsQuery({ uuid }).then((devices: number) => {
		if (devices === 0) {
			res.sendStatus(returnCode);
			return;
		}

		next();
	});
};
