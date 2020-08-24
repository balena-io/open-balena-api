import type { RequestHandler } from 'express';

import { getUser } from '../../infra/auth/auth';
import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling';

import {
	ApiKeyParameters,
	createGenericApiKey as $createGenericApiKey,
	createDeviceApiKey as $createDeviceApiKey,
	createNamedUserApiKey as $createNamedUserApiKey,
	createProvisioningApiKey as $createProvisioningApiKey,
	createUserApiKey as $createUserApiKey,
} from './lib';

export const createGenericApiKey: RequestHandler = async (req, res) => {
	const body = req.body as ApiKeyParameters;

	try {
		const apiKey = await $createGenericApiKey(req, body);
		res.json(apiKey);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating API key', { req });
		res.status(500).send(translateError(err));
	}
};

export const createDeviceApiKey: RequestHandler = async (req, res) => {
	const deviceId = parseInt(req.params.deviceId, 10);
	if (!Number.isFinite(deviceId)) {
		res.status(400).send('Device id must be a number');
		return;
	}

	try {
		const apiKey = await $createDeviceApiKey(req, deviceId, {
			apiKey: req.body.apiKey,
		});
		res.json(apiKey);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating device API key', { req });
		res.status(500).send(translateError(err));
	}
};

export const createProvisioningApiKey: RequestHandler = async (req, res) => {
	const appId = parseInt(req.params.appId, 10);
	if (!Number.isFinite(appId)) {
		res.status(400).send('Application id must be a number');
		return;
	}

	try {
		const apiKey = await $createProvisioningApiKey(req, appId);
		res.json(apiKey);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating provisioning API key', { req });
		res.status(500).send(translateError(err));
	}
};

/**
 * @deprecated this is a legacy api key for very old devices and should not be used any more
 */
export const createUserApiKey: RequestHandler = async (req, res) => {
	try {
		const user = await getUser(req);
		const apiKey = await $createUserApiKey(req, user.id);
		res.json(apiKey);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating user API key', { req });
		res.status(500).send(translateError(err));
	}
};

export const createNamedUserApiKey: RequestHandler = async (req, res) => {
	const { name, description } = req.body;
	if (!name) {
		return res.status(400).send('API keys require a name');
	}

	try {
		const apiKey = await $createNamedUserApiKey(req, req.user.id, {
			name,
			description,
		});
		res.json(apiKey);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating named user API key', { req });
		res.status(500).send(translateError(err));
	}
};
