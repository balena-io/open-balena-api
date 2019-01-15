import { reqHasPermission, getUser } from './auth';
import { retrieveAPIKey } from './api-keys';
import { RequestHandler } from 'express';

import { resinApi, root } from './index';

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
