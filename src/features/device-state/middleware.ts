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
 * This checks if a device is deleted or frozen and responds according to the passed statusCode(s)
 */
export const resolveOrDenyDevicesWithStatus = (
	statusCode: number | { deleted: number; frozen: number },
): RequestHandler => {
	const deletedStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.deleted;
	const frozenStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.frozen;

	return async (req, res, next) => {
		const device = await checkDeviceExistsIsFrozen(req.params.uuid);
		if (device == null) {
			// Gracefully deny deleted devices
			res.status(deletedStatusCode).end();
			return;
		}
		if (device.is_frozen) {
			// Gracefully deny frozen devices
			res.status(frozenStatusCode).end();
			return;
		}

		req.custom ??= {};
		(req.custom as ResolveDeviceInfoCustomObject).resolvedDevice = device.id;
		next();
	};
};
