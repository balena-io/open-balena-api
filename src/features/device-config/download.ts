import type { Request } from 'express';

import { sbvrUtils, errors, type permissions } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling/index.js';

import { generateConfig } from './device-config.js';
import { getDeviceTypeJsonBySlug } from '../device-types/device-types.js';
import { checkInt } from '../../lib/utils.js';
import { getApiKeyOptsFromRequest } from '../api-keys/lib.js';
import {
	createValidatedRequestHandler,
	z,
} from '../../infra/validation/index.js';

const { UnauthorizedError, NotFoundError, BadRequestError } = errors;
const { api } = sbvrUtils;

const getApp = async (appId: number, req: permissions.PermissionReq) => {
	const app = await api.resin.get({
		resource: 'application',
		id: appId,
		passthrough: { req },
		options: {
			$select: 'id',
			$expand: {
				is_for__device_type: {
					$select: ['slug'],
				},
			},
		},
	} as const);

	// Check that the current user has access to this application.
	if (app == null) {
		throw new UnauthorizedError(
			'You do not have permission to access this application',
		);
	}
	return app;
};

export const downloadImageConfig = createValidatedRequestHandler(
	{
		// TODO: this should be stricter with which properties are required/not actually optional
		// The `looseObject` is because different device types can have options specific to them and so we cannot provide a complete set here..
		query: z.looseObject({
			version: z.string().optional(),
			fileType: z.string().optional(),
			appId: z.string().optional(),
			releaseId: z.string().optional(),
			hostname: z.string().optional(),
			deviceType: z.string().optional(),
			imageType: z.string().optional(),
			developmentMode: z.string().optional(),
			appUpdatePollInterval: z.string().optional(),
			network: z.string().optional(),
			wifiSsid: z.string().optional(),
			wifiKey: z.string().optional(),
			ip: z.string().optional(),
			gateway: z.string().optional(),
			netmask: z.string().optional(),
			secureboot: z.string().optional(),

			provisioningKeyName: z.string().optional(),
			provisioningKeyDescription: z.string().optional(),
			provisioningKeyExpiryDate: z.string().optional(),
		}),
		// TODO: this should be stricter with which properties are required/not actually optional
		// The `looseObject` is because different device types can have options specific to them and so we cannot provide a complete set here..
		body: z.looseObject({
			version: z.string().nullish(),
			fileType: z.string().nullish(),
			appId: z.string().or(z.number()).nullish(),
			releaseId: z.string().or(z.number()).nullish(),
			hostname: z.string().nullish(),
			deviceType: z.string().nullish(),
			imageType: z.string().nullish(),
			developmentMode: z.string().or(z.boolean()).optional(),
			appUpdatePollInterval: z.string().or(z.number()).optional(),
			network: z.string().optional(),
			wifiSsid: z.string().optional(),
			wifiKey: z.string().optional(),
			ip: z.string().optional(),
			gateway: z.string().optional(),
			netmask: z.string().optional(),
			secureboot: z.string().or(z.boolean()).optional(),

			provisioningKeyName: z.string().nullish(),
			provisioningKeyDescription: z.string().nullish(),
			provisioningKeyExpiryDate: z.string().nullish(),
		}),
	},
	async (req, res) => {
		try {
			// Combining both req.body and req.query given both GET and POST support
			// Ref: https://github.com/balena-io/balena-api/blob/master/src/routes/applications.ts#L95
			req.body = {
				...req.query,
				...req.body,
			};
			req.query = {};

			const appId = checkInt(req.body.appId);
			if (!appId) {
				throw new BadRequestError('An appId is required.');
			}

			const deviceTypeSlug = req.body.deviceType;
			const osVersion = req.body.version;

			if (!osVersion) {
				throw new BadRequestError('A version is required.');
			}

			if (deviceTypeSlug != null && typeof deviceTypeSlug !== 'string') {
				throw new BadRequestError('Device type must be a string if provided');
			}

			const provisioningKeyOptions = getApiKeyOptsFromRequest(
				req.body,
				'provisioningKey',
			);

			provisioningKeyOptions.name ??=
				'Automatically generated provisioning key';
			provisioningKeyOptions.description ??=
				'Automatically generated for a config file generation';

			const resinApi = api.resin.clone({ passthrough: { req } });

			const app = await getApp(appId, req);
			const deviceTypeJson = await getDeviceTypeJsonBySlug(
				resinApi,
				deviceTypeSlug ?? app.is_for__device_type[0].slug,
			);
			const config = await generateConfig(
				// TODO: This can be removed when `generateConfig` no longer checks both body/query on the req
				req as unknown as Request,
				app,
				provisioningKeyOptions,
				deviceTypeJson,
				osVersion,
			);

			res.json(config);
		} catch (err) {
			let errorToReturn = err;
			if (errorToReturn instanceof UnauthorizedError) {
				errorToReturn = new NotFoundError(errorToReturn);
			}
			// We need to cast here because the `req.query` typing has `unknown` as keys which is incompatible
			if (handleHttpErrors(req as unknown as Request, res, errorToReturn)) {
				return;
			}
			captureException(errorToReturn, 'Error generating config');
			res.status(500).send(translateError(errorToReturn));
		}
	},
);
