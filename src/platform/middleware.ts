import { RequestHandler } from 'express';
import { API_HEARTBEAT_STATE_ENABLED } from '../lib/config';
import { retrieveAPIKey } from './api-keys';
import { getUser, reqHasPermission } from './auth';

import { sbvrUtils } from '@resin/pinejs';

const { root, api } = sbvrUtils;

import * as _ from 'lodash';
import * as DeviceOnlineState from '../lib/device-online-state';
import { captureException } from './errors';

export const authenticated: RequestHandler = async (req, res, next) => {
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

export const authorized: RequestHandler = async (req, res, next) => {
	try {
		await getUser(req);
		next();
		return null;
	} catch {
		res.sendStatus(401);
	}
};

export const identify: RequestHandler = async (req, _res, next) => {
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

const checkDeviceExistsQuery = api.resin.prepare<{ uuid: string }>({
	resource: 'device/$count',
	passthrough: { req: root },
	options: {
		$filter: {
			uuid: { '@': 'uuid' },
		},
	},
});
export const gracefullyDenyDeletedDevices: RequestHandler = async (
	req,
	res,
	next,
) => {
	const { uuid } = req.params;

	const returnCode = req.method === 'GET' ? 304 : 200;

	const devices = (await checkDeviceExistsQuery({ uuid })) as number;
	if (devices === 0) {
		res.sendStatus(returnCode);
		return;
	}

	next();
};

export const registerDeviceStateEvent = (
	pathToUuid: _.PropertyPath,
): RequestHandler => {
	// only register the state event if the feature is active...
	if (API_HEARTBEAT_STATE_ENABLED !== 1) {
		return (_req, _res, next) => {
			next();
		};
	}

	pathToUuid = _.toPath(pathToUuid);

	return (req, _res, next) => {
		const uuid = _.get(req, pathToUuid, '');
		if (uuid !== '') {
			DeviceOnlineState.getPollInterval(uuid)
				.then((pollInterval) =>
					DeviceOnlineState.getInstance().captureEventFor(
						uuid,
						pollInterval / 1000,
					),
				)
				.catch((err) => {
					captureException(
						err,
						`Unable to capture the API heartbeat event for device: ${uuid}`,
					);
				});
		}

		next();
	};
};
