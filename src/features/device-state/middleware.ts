import type { RequestHandler } from 'express';
import * as _ from 'lodash';
import { multiCacheMemoizee } from '../../infra/cache';

import { sbvrUtils, permissions } from '@balena/pinejs';
import { MINUTES } from '../../lib/config';

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
		undefinedAs: false,
		promise: true,
		primitive: true,
		maxAge: 5 * MINUTES,
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
