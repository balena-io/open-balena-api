import type { RequestHandler, Request, Response } from 'express';
import _ from 'lodash';
import { multiCacheMemoizee } from '../../infra/cache/index.js';
import type { Device } from '../../balena-model.js';

import { sbvrUtils, permissions } from '@balena/pinejs';
import { DEVICE_EXISTS_CACHE_TIMEOUT } from '../../lib/config.js';
import { setTimeout } from 'timers/promises';

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
	async (
		uuid: string,
	): Promise<Pick<Device['Read'], 'id' | 'is_frozen'> | undefined> => {
		return await checkDeviceExistsIsFrozenQuery()({ uuid });
	},
	{
		cacheKey: 'checkDeviceExistsIsFrozen',
		promise: true,
		primitive: true,
		undefinedAs: false,
		maxAge: DEVICE_EXISTS_CACHE_TIMEOUT,
	},
	{ useVersion: false },
);

export interface ResolveDeviceInfoCustomObject {
	resolvedDeviceIds: Array<Device['Read']['id']>;
}

const requestParamsUuidResolver = (req: Request) => [req.params.uuid];

export const defaultRespondFn = async (
	_req: Request,
	res: Response,
	delayMs: number,
	status: number,
): Promise<void> => {
	if (delayMs > 0) {
		await setTimeout(delayMs);
	}
	res.status(status).end();
};

let respondFn = defaultRespondFn;
/**
 * Set the function used to respond to the deleted/frozen device request.
 */
export const setRespondFn = ($respondFn: typeof respondFn) => {
	respondFn = $respondFn;
};

/**
 * This checks if a device is deleted or frozen and responds according to the passed statusCode(s)
 */
export const resolveOrDenyDevicesWithStatus = (
	statusCode: number | { deleted: number; frozen: number },
	uuidResolver: (req: Request) => string[] = requestParamsUuidResolver,
	delayMs = 0,
): RequestHandler => {
	const deletedStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.deleted;
	const frozenStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.frozen;

	return async (req, res, next) => {
		const uuids = uuidResolver(req);
		if (!uuids.length) {
			await respondFn(req, res, delayMs, deletedStatusCode);
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
				await respondFn(req, res, delayMs, deletedStatusCode);
				return;
			}
			if (device.is_frozen) {
				// Gracefully deny frozen devices
				await respondFn(req, res, delayMs, frozenStatusCode);
				return;
			}
			deviceIds.push(device.id);
		}
		req.custom ??= {};
		(req.custom as ResolveDeviceInfoCustomObject).resolvedDeviceIds = deviceIds;
		next();
	};
};
