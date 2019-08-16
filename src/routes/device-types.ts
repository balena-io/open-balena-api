import * as Promise from 'bluebird';
import { RequestHandler } from 'express';
import * as _ from 'lodash';
import * as deviceTypesLib from '../lib/device-types';
import { resinApi } from '../platform';
import {
	captureException,
	translateError,
	handleHttpErrors,
} from '../platform/errors';

export const getDeviceTypes: RequestHandler = (req, res) => {
	const api = resinApi.clone({ passthrough: { req } });
	return deviceTypesLib
		.deviceTypes(api)
		.then(deviceTypes => {
			res.json(deviceTypes);
		})
		.catch(err => {
			captureException(err, 'Error getting device types', { req });
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			res.status(500).send(translateError(err));
		});
};

export const getDeviceType: RequestHandler = (req, res) =>
	Promise.try(() => {
		const api = resinApi.clone({ passthrough: { req } });
		const slug = deviceTypesLib.validateSlug(req.params.deviceType);
		return deviceTypesLib.findBySlug(api, slug);
	})
		.then(data => res.json(data))
		.catch(err => {
			captureException(err, 'Error getting device type', {
				req,
			});
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			res.status(500).send(translateError(err));
		});

export const listAvailableImageVersions: RequestHandler = (req, res) =>
	Promise.try(() => {
		const api = resinApi.clone({ passthrough: { req } });
		const slug = deviceTypesLib.validateSlug(req.params.deviceType);
		return deviceTypesLib.getImageVersions(api, slug);
	})
		.then(data => res.json(data))
		.catch(err => {
			captureException(err, 'Error getting image versions', { req });
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			res.status(500).send(translateError(err));
		});

const DOWNLOAD_TIMEOUT = 30000; // we must respond within this time

export const downloadImageSize: RequestHandler = (req, res) => {
	req.setTimeout(DOWNLOAD_TIMEOUT, _.noop);
	return Promise.try(() => {
		const api = resinApi.clone({ passthrough: { req } });
		const slug = deviceTypesLib.validateSlug(req.params.deviceType);
		const buildId: string = req.params.version || 'latest';
		return deviceTypesLib.getImageSize(api, slug, buildId);
	})
		.then(size => {
			res.send({ size });
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error getting download size', { req });
			res.status(500).send(translateError(err));
		});
};
