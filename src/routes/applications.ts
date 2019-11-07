import * as _ from 'lodash';

import * as Promise from 'bluebird';

import { generateConfig } from '../lib/device-config';
import { findBySlug } from '../lib/device-types';

import {
	captureException,
	translateError,
	handleHttpErrors,
} from '../platform/errors';
import { sbvrUtils } from '@resin/pinejs';
import { RequestHandler, Request } from 'express';

const { UnauthorizedError, api } = sbvrUtils;

const getApp = (req: Request): Promise<AnyObject> =>
	api.resin
		.get({
			resource: 'application',
			id: req.param('appId'),
			passthrough: { req },
			options: {
				$select: ['id', 'app_name'],
				$expand: {
					is_for__device_type: {
						$select: ['slug'],
					},
				},
			},
		})
		.then((app: AnyObject) => {
			// Check that the current user has access to this application.
			if (app == null) {
				throw new UnauthorizedError(
					'You do not have permission to access this application',
				);
			}
			return app;
		});

export const downloadImageConfig: RequestHandler = (req, res) => {
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

	const resinApi = api.resin.clone({ passthrough: { req } });

	return getApp(req)
		.then(app =>
			findBySlug(
				resinApi,
				deviceTypeSlug || app.is_for__device_type[0].slug,
			).then(deviceType => generateConfig(req, app, deviceType, osVersion)),
		)
		.then(config => {
			res.json(config);
		})
		.catch(UnauthorizedError, err => {
			res.status(404).send(err.message);
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error generating config', { req });
			res.status(500).send(translateError(err));
		});
};
