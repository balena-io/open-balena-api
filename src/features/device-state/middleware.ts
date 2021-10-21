import type { RequestHandler } from 'express';
import * as _ from 'lodash';
import { multiCacheMemoizee } from '../../infra/cache';

import { sbvrUtils, permissions } from '@balena/pinejs';
import { DEVICE_EXISTS_CACHE_TIMEOUT } from '../../lib/config';

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
export const checkDeviceExists = multiCacheMemoizee(
	async (uuid: string): Promise<boolean> => {
		const devices = await checkDeviceExistsQuery()({ uuid });
		return devices !== 0;
	},
	{
		cacheKey: 'checkDeviceExists',
		promise: true,
		primitive: true,
		maxAge: DEVICE_EXISTS_CACHE_TIMEOUT,
	},
);

export const gracefullyDenyDeletedDevices: RequestHandler = async (
	req,
	res,
	next,
) => {
	const deviceExists = await checkDeviceExists(req.params.uuid);
	if (!deviceExists) {
		const returnCode = req.method === 'GET' ? 304 : 200;
		res.status(returnCode).end();
		return;
	}

	next();
};
