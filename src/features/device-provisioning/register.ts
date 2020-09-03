import type { RequestHandler } from 'express';
import * as _ from 'lodash';
import * as randomstring from 'randomstring';

import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling';

import { createDeviceApiKey } from '../api-keys/lib';
import { checkInt } from '../../lib/utils';

const { BadRequestError, ConflictError } = errors;
const { api } = sbvrUtils;

export const register: RequestHandler = async (req, res) => {
	try {
		const userId = req.body.user == null ? null : checkInt(req.body.user);
		if (userId === false) {
			throw new BadRequestError('User ID must be a valid integer');
		}

		const applicationId = checkInt(req.body.application);
		if (applicationId === false) {
			throw new BadRequestError('Application ID must be a valid integer');
		}

		const deviceType = req.body.device_type;
		if (deviceType == null) {
			throw new BadRequestError('Device type must be specified');
		}

		const uuid = req.body.uuid;
		if (uuid == null) {
			throw new BadRequestError('UUID must be specified');
		}

		if (req.apiKey == null) {
			throw new BadRequestError('API key must be used for registering');
		}

		const supervisorVersion = req.body.supervisor_version;
		const deviceApiKey = req.body.api_key ?? randomstring.generate();

		// Temporarily give the ability to fetch the device we create and create an api key for it,
		// but clone to make sure it isn't propagated elsewhere
		req = _.clone(req);
		req.apiKey = _.cloneDeep(req.apiKey);
		if (req.apiKey != null && req.apiKey.permissions != null) {
			req.apiKey.permissions.push('resin.device.read');
			req.apiKey.permissions.push('resin.device.create-device-api-key');
		}

		const response = await sbvrUtils.db.transaction(async (tx) => {
			const device = await api.resin.post({
				resource: 'device',
				passthrough: { req, tx },
				body: {
					belongs_to__user: userId,
					belongs_to__application: applicationId,
					device_type: deviceType,
					supervisor_version: supervisorVersion,
					uuid,
				},
			});
			if (device == null) {
				throw new Error('Failed to create device');
			}
			const apiKey = await createDeviceApiKey(req, device.id, {
				apiKey: deviceApiKey,
				tx,
			});
			return {
				id: device.id,
				uuid: device.uuid,
				api_key: apiKey,
			};
		});

		res.status(201).json(response);
	} catch (err) {
		if (err instanceof ConflictError && err.message.includes('uuid')) {
			// WORKAROUND: balena-supervisor >= v4.2.0 < v11.4.14 rely on the specific error message rather than a 409
			// so we convert the error here to ensure they can continue to work, this should be removed once we drop
			// support for those supervisor versions
			res.status(err.status).send('"uuid" must be unique.');
			return;
		}
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error registering device', { req });
		res.status(403).send(translateError(err));
	}
};
