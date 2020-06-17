import type { Request, RequestHandler } from 'express';

import { sbvrUtils, errors } from '@resin/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../platform/errors';

import { generateConfig } from '../lib/device-config';
import { findBySlug } from '../lib/device-types';

const { UnauthorizedError, NotFoundError } = errors;
const { api } = sbvrUtils;

const getApp = async (req: Request): Promise<AnyObject> => {
	const app = (await api.resin.get({
		resource: 'application',
		id: req.param('appId'),
		passthrough: { req },
		options: {
			$select: 'id',
			$expand: {
				is_for__device_type: {
					$select: ['slug'],
				},
			},
		},
	})) as AnyObject;

	// Check that the current user has access to this application.
	if (app == null) {
		throw new UnauthorizedError(
			'You do not have permission to access this application',
		);
	}
	return app;
};

export const downloadImageConfig: RequestHandler = async (req, res) => {
	if (!req.param('appId')) {
		res.status(400).send('An appId is required.');
		return;
	}

	const deviceTypeSlug = req.param('deviceType');
	const osVersion = req.param('version');

	if (!osVersion) {
		res.status(400).send('A version is required.');
		return;
	}

	try {
		const resinApi = api.resin.clone({ passthrough: { req } });

		const app = await getApp(req);
		const deviceType = await findBySlug(
			resinApi,
			deviceTypeSlug || app.is_for__device_type[0].slug,
		);
		const config = await generateConfig(req, app, deviceType, osVersion);

		res.json(config);
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			err = new NotFoundError(err);
		}
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error generating config', { req });
		res.status(500).send(translateError(err));
	}
};
