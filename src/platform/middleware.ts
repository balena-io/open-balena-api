import { reqHasPermission, getUser } from './auth';
import { retrieveAPIKey } from './api-keys';
import { RequestHandler } from 'express';

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

export const apiKeyMiddleware: RequestHandler = (req, _res, next) =>
	// Note: this won't reply with 401 if there's no api key
	retrieveAPIKey(req).asCallback(next);

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
