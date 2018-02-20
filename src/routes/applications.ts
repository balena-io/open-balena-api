import * as _ from 'lodash';

import * as Promise from 'bluebird';

import { generateConfig } from '../lib/device-config';

import {
	captureException,
	translateError,
	handleHttpErrors,
} from '../platform/errors';
import { resinApi, sbvrUtils } from '../platform';
import { RequestHandler, Request } from 'express';

const { UnauthorizedError } = sbvrUtils;

const getApp = (req: Request): Promise<AnyObject> =>
	resinApi
		.get({
			resource: 'application',
			id: req.param('appId'),
			passthrough: { req },
			options: {
				$select: ['id', 'app_name', 'device_type'],
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
	return getApp(req)
		.then(app => generateConfig(req, app))
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

export const myApps: RequestHandler = (req, res) =>
	resinApi
		.get({
			resource: 'application',
			passthrough: { req },
		})
		.then(data => {
			res.send({ d: data });
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			res.sendStatus(500);
		});
