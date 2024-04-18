import type { RequestHandler } from 'express';
import _ from 'lodash';

import { sbvrUtils } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling/index.js';

import * as deviceTypesLib from './device-types.js';

const { api } = sbvrUtils;

export const getDeviceTypes: RequestHandler = async (req, res) => {
	const resinApi = api.resin.clone({ passthrough: { req } });
	try {
		const deviceTypes =
			await deviceTypesLib.getAccessibleDeviceTypeJsons(resinApi);
		res.json(deviceTypes);
	} catch (err) {
		captureException(err, 'Error getting device types');
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(500).send(translateError(err));
	}
};

export const getDeviceType: RequestHandler = async (req, res) => {
	try {
		const resinApi = api.resin.clone({ passthrough: { req } });
		const slug = deviceTypesLib.validateSlug(req.params.deviceType);
		const data = await deviceTypesLib.getDeviceTypeJsonBySlug(resinApi, slug);
		res.json(data);
	} catch (err) {
		captureException(err, 'Error getting device type');
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(500).send(translateError(err));
	}
};

const DOWNLOAD_TIMEOUT = 30000; // we must respond within this time

export const downloadImageSize: RequestHandler = async (req, res) => {
	req.setTimeout(DOWNLOAD_TIMEOUT, _.noop);
	try {
		const resinApi = api.resin.clone({ passthrough: { req } });
		const slug = deviceTypesLib.validateSlug(req.params.deviceType);
		const buildId: string = req.params.version || 'latest';
		const size = await deviceTypesLib.getImageSize(resinApi, slug, buildId);
		res.json({ size });
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting download size');
		res.status(500).send(translateError(err));
	}
};
