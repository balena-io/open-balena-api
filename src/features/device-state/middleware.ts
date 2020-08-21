import type { RequestHandler } from 'express';
import * as _ from 'lodash';

import { sbvrUtils, permissions } from '@balena/pinejs';

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
