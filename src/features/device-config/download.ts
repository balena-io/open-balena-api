import type { Request, RequestHandler } from 'express';

import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling/index.js';

import { generateConfig } from './device-config.js';
import { findBySlug } from '../device-types/device-types.js';
import { checkInt, getBodyOrQueryParam } from '../../lib/utils.js';

const { UnauthorizedError, NotFoundError } = errors;
const { api } = sbvrUtils;

const getApp = async (appId: number, req: Request) => {
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

export const downloadImageConfig: RequestHandler = async (req, res) => {
	const appId = checkInt(getBodyOrQueryParam(req, 'appId'));
	if (!appId) {
		res.status(400).send('An appId is required.');
		return;
	}

	const deviceTypeSlug = getBodyOrQueryParam(req, 'deviceType');
	const osVersion = getBodyOrQueryParam(req, 'version');

	if (!osVersion) {
		res.status(400).send('A version is required.');
		return;
	}

	try {
		const resinApi = api.resin.clone({ passthrough: { req } });

		const app = await getApp(appId, req);
		const deviceTypeJson = await findBySlug(
			resinApi,
			deviceTypeSlug || app.is_for__device_type[0].slug,
		);
		const config = await generateConfig(req, app, deviceTypeJson, osVersion);

		res.json(config);
	} catch (err) {
		let errorToReturn = err;
		if (errorToReturn instanceof UnauthorizedError) {
			errorToReturn = new NotFoundError(errorToReturn);
		}
		if (handleHttpErrors(req, res, errorToReturn)) {
			return;
		}
		captureException(errorToReturn, 'Error generating config', { req });
		res.status(500).send(translateError(errorToReturn));
	}
};
