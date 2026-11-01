import type { Response } from 'express';
import _ from 'lodash';
import { multiCacheMemoizee } from '../../infra/cache/index.ts';
import type { Device } from '../../balena-model.ts';

import { sbvrUtils, permissions } from '@balena/pinejs';
import { DEVICE_EXISTS_CACHE_TIMEOUT } from '../../lib/config.ts';
import { setTimeout } from 'timers/promises';
import {
	createUnvalidatedRequestHandler,
	type RequestExcludingInput,
} from '../../infra/validation/index.ts';

const { api } = sbvrUtils;

const checkDeviceExistsIsFrozenQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'device',
			passthrough: { req: permissions.rootRead },
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

const requestParamsUuidResolver = (req: RequestExcludingInput) => [
	req.params.uuid,
];

export const defaultRespondFn = async (
	req: RequestExcludingInput,
	res: Response,
	delayMs: number,
	status: number,
): Promise<void> => {
	if (delayMs > 0) {
		// The request is not used again after the delay, and there can be many delayed requests
		// in parallel, so release the parsed body rather than holding it for the whole delay
		req.body = undefined;
		// Likewise stop reading any unread request body (eg log streams) during the delay, leaving it in the
		// kernel's socket buffer to apply backpressure, rather than buffering up to the highWaterMark in memory
		const pauseSocket = !req.complete;
		if (pauseSocket) {
			req.socket.pause();
		}
		await setTimeout(delayMs);
		if (pauseSocket) {
			// Resume so that node can discard the rest of the body and reuse the connection once we respond
			req.socket.resume();
		}
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
	uuidResolver: (
		req: RequestExcludingInput,
	) => string[] = requestParamsUuidResolver,
	delayMs = 0,
) => {
	const deletedStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.deleted;
	const frozenStatusCode =
		typeof statusCode === 'number' ? statusCode : statusCode.frozen;

	return createUnvalidatedRequestHandler(async (req, res, next) => {
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
	});
};
