import type { RequestHandler } from 'express';
import _ from 'lodash';
import { multiCacheMemoizee } from '../../infra/cache';
import type { Device } from '../../balena-model';

import { sbvrUtils, permissions } from '@balena/pinejs';
import { DEVICE_EXISTS_CACHE_TIMEOUT } from '../../lib/config';

const { api } = sbvrUtils;

const $select = ['id', 'is_frozen'] satisfies Array<keyof Device>;
const checkDeviceExistsIsFrozenQuery = _.once(() =>
	api.resin.prepare<{ uuid: string }>({
		resource: 'device',
		passthrough: { req: permissions.root },
		id: {
			uuid: { '@': 'uuid' },
		},
		options: {
			$select,
		},
	}),
);
export const checkDeviceExistsIsFrozen = multiCacheMemoizee(
	async (
		uuid: string,
	): Promise<Pick<Device, (typeof $select)[number]> | undefined> => {
		return (await checkDeviceExistsIsFrozenQuery()({ uuid })) as
			| Pick<Device, (typeof $select)[number]>
			| undefined;
	},
	{
		cacheKey: 'checkDeviceExistsIsFrozen',
		promise: true,
		primitive: true,
		undefinedAs: false,
		maxAge: DEVICE_EXISTS_CACHE_TIMEOUT,
	},
);

export interface ResolveDeviceInfoCustomObject {
	resolvedDevice: Device['id'];
}

/**
 * This checks if a device is deleted or frozen and responds accordingly:
 * Device is deleted and it's a GET request = 304
 * Device is deleted and it's a non-GET request = 200
 * Device is frozen and it's a GET request = 304
 * Device is frozen and it's a non-GET request = 401
 */
export const resolveOrGracefullyDenyDevices: RequestHandler = async (
	req,
	res,
	next,
) => {
	const device = await checkDeviceExistsIsFrozen(req.params.uuid);
	if (device == null) {
		// Gracefully deny deleted devices
		const returnCode = req.method === 'GET' ? 304 : 200;
		res.status(returnCode).end();
		return;
	}
	if (device.is_frozen) {
		// Gracefully deny frozen devices
		const returnCode = req.method === 'GET' ? 304 : 401;
		res.status(returnCode).end();
		return;
	}

	req.custom ??= {};
	(req.custom as ResolveDeviceInfoCustomObject).resolvedDevice = device.id;
	next();
};
