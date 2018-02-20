import * as _ from 'lodash';
import {
	createProvisioningApiKey as $createProvisioningApiKey,
	createDeviceApiKey as $createDeviceApiKey,
	createUserApiKey as $createUserApiKey,
	createNamedUserApiKey as $createNamedUserApiKey,
} from '../lib/api-keys';
import { getUser } from '../platform/auth';
import { captureException, translateError } from '../platform/errors';
import { RequestHandler } from 'express';

export const createDeviceApiKey: RequestHandler = (req, res) => {
	const deviceId = _.parseInt(req.params.deviceId, 10);
	if (!_.isFinite(deviceId)) {
		res.status(400).send('Device id must be a number');
		return;
	}

	return $createDeviceApiKey(req, deviceId, { apiKey: req.body.apiKey })
		.then(apiKey => {
			res.json(apiKey);
		})
		.catch(err => {
			captureException(err, 'Error generating device API key', { req });
			res.status(500).send(translateError(err));
		});
};

export const createProvisioningApiKey: RequestHandler = (req, res) => {
	const appId = _.parseInt(req.params.appId, 10);
	if (!_.isFinite(appId)) {
		res.status(400).send('Application id must be a number');
		return;
	}

	return $createProvisioningApiKey(req, appId)
		.then(apiKey => {
			res.json(apiKey);
		})
		.catch(err => {
			captureException(err, 'Error generating provisioning API key', { req });
			res.status(500).send(translateError(err));
		});
};

// FIXME(refactor): this is legacy; move it out of here
export const createUserApiKey: RequestHandler = (req, res) =>
	getUser(req)
		.then(user => $createUserApiKey(req, user.id))
		.then(apiKey => {
			res.json(apiKey);
		})
		.catch(err => {
			captureException(err, 'Error generating user API key', { req });
			res.status(500).send(translateError(err));
		});

export const createNamedUserApiKey: RequestHandler = (req, res) => {
	const { name, description } = req.body;
	if (!name) {
		return res.status(400).send('API keys require a name');
	}

	return $createNamedUserApiKey(req, req.user.id, { name, description })
		.then(apiKey => {
			res.json(apiKey);
		})
		.catch(err => {
			captureException(err, 'Error generating named user API key', { req });
			res.status(500).send(translateError(err));
		});
};
