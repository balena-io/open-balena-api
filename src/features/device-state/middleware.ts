import type { RequestHandler } from 'express';
import * as _ from 'lodash';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { captureException } from '../../infra/error-handling';

import { API_HEARTBEAT_STATE_ENABLED } from '../../lib/config';
import * as DeviceOnlineState from '../../lib/device-online-state';

const { api } = sbvrUtils;

const checkDeviceExistsQuery = _.once(() =>
	api.resin.prepare<{ uuid: string }>({
		resource: 'device',
		passthrough: { req: permissions.root },
		options: {
			$count: {
				$filter: {
					uuid: { '@': 'uuid' },
				},
			},
		},
	}),
);

export const gracefullyDenyDeletedDevices: RequestHandler = async (
	req,
	res,
	next,
) => {
	const { uuid } = req.params;

	const returnCode = req.method === 'GET' ? 304 : 200;

	const devices = await checkDeviceExistsQuery()({ uuid });
	if (devices === 0) {
		res.sendStatus(returnCode);
		return;
	}

	next();
};

export const registerDeviceStateEvent = (
	pathToUuid: _.PropertyPath,
): RequestHandler => {
	// only register the state event if the feature is active...
	if (API_HEARTBEAT_STATE_ENABLED !== 1) {
		return (_req, _res, next) => {
			next();
		};
	}

	pathToUuid = _.toPath(pathToUuid);

	return (req, _res, next) => {
		const uuid = _.get(req, pathToUuid, '');
		if (uuid !== '') {
			DeviceOnlineState.getPollInterval(uuid)
				.then((pollInterval) =>
					DeviceOnlineState.getInstance().captureEventFor(
						uuid,
						pollInterval / 1000,
					),
				)
				.catch((err) => {
					captureException(
						err,
						`Unable to capture the API heartbeat event for device: ${uuid}`,
					);
				});
		}

		next();
	};
};
