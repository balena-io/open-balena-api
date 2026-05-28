import { errors, sbvrUtils } from '@balena/pinejs';
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
import {
	createValidatedRequestHandler,
	z,
} from '../../infra/validation/index.js';

export const createGenericApiKey = (version: 'v1' | 'v2') => {
	const mandatoryExpiryDate = version !== 'v1';
	return createValidatedRequestHandler(
		{
			body: z.object({
				actorType: z.enum(supportedActorTypes),
				actorTypeId: z.number(),
				roles: z.array(z.string().min(1)).min(1),
				apiKey: z.string().nullish(),
				// These are for `getApiKeyOptsFromRequest`
				name: z.string().nullish(),
				description: z.string().nullish(),
				expiryDate: z.string().nullish(),
			}),
		},
		async (req, res) => {
			try {
				const apiKeyOptions = getApiKeyOptsFromRequest(
					req.body,
					undefined,
					mandatoryExpiryDate,
				);
				const {
					actorType,
					actorTypeId,
					roles,
					apiKey: chosenApiKey,
				} = req.body;

				const apiKey = await $createGenericApiKey(req, {
					actorType,
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
				captureException(err, 'Error generating API key');
				res.status(500).send(translateError(err));
			}
		},
	);
};

export const createDeviceApiKey = createValidatedRequestHandler(
	{
		body: z.object({
			apiKey: z.string().nullish(),
			// These are for `getApiKeyOptsFromRequest`
			name: z.string().nullish(),
			description: z.string().nullish(),
			expiryDate: z.string().nullish(),
		}),
	},
	async (req, res) => {
		const deviceId = parseInt(req.params.deviceId, 10);
		if (!Number.isFinite(deviceId)) {
			res.status(400).send('Device id must be a number');
			return;
		}

		try {
			const apiKey = await $createDeviceApiKey(req, req.body, deviceId, {
				apiKey: req.body.apiKey ?? undefined,
				...getApiKeyOptsFromRequest(req.body),
			});
			res.json(apiKey);
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error generating device API key');
			res.status(500).send(translateError(err));
		}
	},
);

export const createProvisioningApiKey = createValidatedRequestHandler(
	{
		body: z.object({
			// These are for `getApiKeyOptsFromRequest`
			name: z.string().nullish(),
			description: z.string().nullish(),
			expiryDate: z.string().nullish(),
		}),
	},
	async (req, res) => {
		const appId = parseInt(req.params.appId, 10);
		if (!Number.isFinite(appId)) {
			res.status(400).send('Application id must be a number');
			return;
		}

		try {
			const apiKey = await $createProvisioningApiKey(
				req,
				req.body,
				appId,
				getApiKeyOptsFromRequest(req.body),
			);
			res.json(apiKey);
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error generating provisioning API key');
			res.status(500).send(translateError(err));
		}
	},
);

/**
 * @deprecated this is a legacy api key for very old devices and should not be used any more
 */
export const createUserApiKey = createValidatedRequestHandler(
	{
		body: z.object({
			// These are for `getApiKeyOptsFromRequest`
			name: z.string().nullish(),
			description: z.string().nullish(),
			expiryDate: z.string().nullish(),
		}),
	},
	async (req, res) => {
		try {
			const keyMetadata = getApiKeyOptsFromRequest(req.body);

			const apiKey = await sbvrUtils.db.transaction(async (tx) => {
				const user = await getUser(req, tx);
				return await $createUserApiKey(req, req.body, user.id, {
					tx,
					...keyMetadata,
				});
			});
			res.json(apiKey);
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error generating user API key');
			res.status(500).send(translateError(err));
		}
	},
);

export const createNamedUserApiKey = createValidatedRequestHandler(
	{
		body: z.object({
			name: z.string().min(1),
			// These are for `getApiKeyOptsFromRequest`
			description: z.string().nullish(),
			expiryDate: z.string().nullish(),
		}),
	},
	async (req, res) => {
		try {
			if (req.user == null) {
				throw new errors.BadRequestError('Must use user auth');
			}

			const apiKey = await $createNamedUserApiKey(
				req,
				req.body,
				req.user.id,
				getApiKeyOptsFromRequest(req.body),
			);
			res.json(apiKey);
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error generating named user API key');
			res.status(500).send(translateError(err));
		}
	},
);
