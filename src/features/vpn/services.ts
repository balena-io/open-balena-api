import type { Request, RequestHandler, Response } from 'express';

import type { permissions } from '@balena/pinejs';
import { sbvrUtils, errors } from '@balena/pinejs';
import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling/index.js';
import {
	multiCacheMemoizee,
	reqPermissionNormalizer,
} from '../../infra/cache/index.js';
import { VPN_AUTH_CACHE_TIMEOUT } from '../../lib/config.js';
import { checkDeviceExistsIsFrozen } from '../device-state/middleware.js';

const { api } = sbvrUtils;

const checkAuth = (() => {
	return multiCacheMemoizee(
		async (uuid: string, req: permissions.PermissionReq): Promise<number> => {
			try {
				await api.resin.request({
					method: 'POST',
					// We use a parameter alias to signify to pinejs that it's a beneficial query to cache
					url: `device(uuid=@uuid)/canAccess?@uuid='${uuid}'`,
					passthrough: {
						req,
					},
					body: { action: 'cloudlink' },
				});
				return 200;
			} catch (err) {
				if (err instanceof errors.UnauthorizedError) {
					// We handle `UnauthorizedError` specially so that we can cache it as it's a relatively
					// common case for devices that have been deleted but are still online/trying to connect
					return 401;
				}
				throw err;
			}
		},
		{
			cacheKey: 'checkAuth',
			promise: true,
			primitive: true,
			maxAge: VPN_AUTH_CACHE_TIMEOUT,
			normalizer: ([uuid, req]) => {
				return `${uuid}$${reqPermissionNormalizer(req)}`;
			},
		},
		{ useVersion: false },
	);
})();

/**
 * A middleware to return 401 for deleted devices and avoid doing any additional work.
 * This shares the deleted device cache with device-state
 */
export const denyDeletedDevices: RequestHandler = async (req, res, next) => {
	const device = await checkDeviceExistsIsFrozen(req.params.uuid);
	if (device == null) {
		// Deny deleted devices
		res.status(401).end();
		return;
	}
	next();
};

export const authDevice = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const statusCode = await checkAuth(req.params.uuid, req);
		res.status(statusCode).end();
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error authenticating device for VPN');
		res.status(500).send(translateError(err));
	}
};
export const clientConnect = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { uuids, serviceId } = req.body ?? {};
	if (!uuids || uuids.length === 0 || !serviceId) {
		res.status(400).end();
		return;
	}

	try {
		await api.resin.patch({
			resource: 'device',
			passthrough: {
				req,
			},
			options: {
				$filter: {
					uuid: { $in: uuids },
				},
			},
			body: {
				is_connected_to_vpn: true,
				is_managed_by__service_instance: serviceId,
			},
		});
		res.status(200).end();
	} catch (err) {
		captureException(err, 'Error with vpn client connect');
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(500).send(translateError(err));
	}
};

export const clientDisconnect = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { uuids, serviceId } = req.body ?? {};
	if (!uuids || uuids.length === 0 || !serviceId) {
		res.status(400).end();
		return;
	}

	try {
		await api.resin.patch({
			resource: 'device',
			passthrough: { req },
			options: {
				$filter: {
					uuid: { $in: uuids },
					// Only disconnect if still managed by this vpn
					is_managed_by__service_instance: serviceId,
				},
			},
			body: {
				is_connected_to_vpn: false,
				is_managed_by__service_instance: null,
			},
		});
		res.status(200).end();
	} catch (err) {
		captureException(err, 'Error with vpn client disconnect');
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(500).send(translateError(err));
	}
};
