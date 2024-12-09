import { errors, sbvrUtils } from '@balena/pinejs';
import type { RequestHandler } from 'express';

import { getUser } from '../../infra/auth/auth.js';
import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling/index.js';

import {
	createGenericApiKey as $createGenericApiKey,
	createDeviceApiKey as $createDeviceApiKey,
	createNamedUserApiKey as $createNamedUserApiKey,
	createProvisioningApiKey as $createProvisioningApiKey,
	createUserApiKey as $createUserApiKey,
	getApiKeyOptsFromRequest,
	supportedActorTypes,
} from './lib.js';

export const createGenericApiKey: RequestHandler = async (req, res) => {
	try {
		const apiKeyOptions = getApiKeyOptsFromRequest(req.body);
		const {
			actorType,
			actorTypeId,
			roles,
			apiKey: chosenApiKey,
		} = req.body as Dictionary<unknown>;

		if (
			typeof actorType !== 'string' ||
			!supportedActorTypes.includes(
				actorType as (typeof supportedActorTypes)[number],
			)
		) {
			throw new errors.BadRequestError('Unsupported actor type');
		}
		if (typeof actorTypeId !== 'number' || !Number.isFinite(actorTypeId)) {
			throw new errors.BadRequestError('Actor type id must be a number');
		}
		if (
			!Array.isArray(roles) ||
			roles.length === 0 ||
			roles.some((r) => typeof r !== 'string' || r.length === 0)
		) {
			throw new errors.BadRequestError(
				'Roles should be an array of role names',
			);
		}

		if (chosenApiKey != null && typeof chosenApiKey !== 'string') {
			throw new errors.BadRequestError('API key must be a string');
		}

		const apiKey = await $createGenericApiKey(req, {
			actorType: actorType as (typeof supportedActorTypes)[number],
			actorTypeId,
			roles,
			apiKey: chosenApiKey ?? undefined,
			...apiKeyOptions,
		});
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
			...getApiKeyOptsFromRequest(req.body),
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
		const apiKey = await $createProvisioningApiKey(
			req,
			appId,
			getApiKeyOptsFromRequest(req.body),
		);
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
		const keyMetadata = getApiKeyOptsFromRequest(req.body);

		const apiKey = await sbvrUtils.db.transaction(async (tx) => {
			const user = await getUser(req, tx);
			return await $createUserApiKey(req, user.id, { tx, ...keyMetadata });
		});
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
	try {
		if (!req.body.name) {
			throw new errors.BadRequestError('API keys require a name');
		}

		if (req.user == null) {
			throw new errors.BadRequestError('Must use user auth');
		}

		const apiKey = await $createNamedUserApiKey(
			req,
			req.user.id,
			getApiKeyOptsFromRequest(req.body),
		);
		res.json(apiKey);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating named user API key', { req });
		res.status(500).send(translateError(err));
	}
};
