import type { RequestHandler } from 'express';
import _ from 'lodash';
import { multiCacheMemoizee } from '../../infra/cache/index.js';
import type { Device } from '../../balena-model.js';

import { sbvrUtils, permissions } from '@balena/pinejs';
import { DEVICE_EXISTS_CACHE_TIMEOUT } from '../../lib/config.js';
import type { Request } from 'express-serve-static-core';

const { api } = sbvrUtils;

const checkDeviceExistsIsFrozenQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'device',
			passthrough: { req: permissions.root },
			id: {
				uuid: { '@': 'uuid' },
			},
			options: {
				$select: ['id', 'is_frozen'],
			},
		},
		{ uuid: ['string'] },
	),
);
export const checkDeviceExistsIsFrozen = multiCacheMemoizee(
	async (uuid: string) => {
		return await checkDeviceExistsIsFrozenQuery()({ uuid });
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
	resolvedDeviceIds: Array<Device['Read']['id']>;
}

const requestParamsUuidResolver = (req: Request) => [req.params.uuid];

/**
 * This checks if a device is deleted or frozen and responds according to the passed statusCode(s)
 */
export const resolveOrDenyDevicesWithStatus = (
	statusCode: number | { deleted: number; frozen: number },
	uuidResolver: (req: Request) => string[] = requestParamsUuidResolver,
): RequestHandler => {
	const deletedStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.deleted;
	const frozenStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.frozen;

	return async (req, res, next) => {
		const uuids = uuidResolver(req);
		if (!uuids.length) {
			res.status(deletedStatusCode).end();
			return;
		}
		const deviceIds: number[] = [];
		for (const uuid of uuids) {
			const device = await checkDeviceExistsIsFrozen(uuid);
			// Heads-up: if any of the provided devices is deleted/frozen
			// then the whole request is rejected! We should revisit this
			// if we later add again support for handling multiple devices
			// per request.
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
			deviceIds.push(device.id);
		}
		req.custom ??= {};
		(req.custom as ResolveDeviceInfoCustomObject).resolvedDeviceIds = deviceIds;
		next();
	};
};
