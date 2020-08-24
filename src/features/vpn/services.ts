import type { Request, Response } from 'express';

import { sbvrUtils } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling';
import { once } from 'lodash';

const { api } = sbvrUtils;

const authQuery = once(() =>
	api.resin.prepare<{ uuid: string }>({
		resource: 'device',
		id: {
			uuid: { '@': 'uuid' },
		},
		options: {
			$select: 'id',
		},
	}),
);
const clientConnectQuery = once(() =>
	api.resin.prepare<{ uuid: string }>({
		method: 'PATCH',
		resource: 'device',
		id: {
			uuid: { '@': 'uuid' },
		},
		body: {
			is_connected_to_vpn: true,
		},
	}),
);
const clientDisconnectQuery = once(() =>
	api.resin.prepare<{
		uuid: string;
		serviceId: number;
	}>({
		method: 'PATCH',
		resource: 'device',
		id: {
			uuid: { '@': 'uuid' },
		},
		options: {
			$filter: {
				// Only disconnect if still managed by this vpn
				is_managed_by__service_instance: { '@': 'serviceId' },
			},
		},
		body: {
			is_connected_to_vpn: false,
			vpn_address: null,
		},
	}),
);
export const authDevice = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const device = await authQuery()(
			{ uuid: req.param('device_uuid') },
			undefined,
			{ req },
		);
		// for now, if the api key is able to read the device,
		// it has vpn access
		if (device) {
			res.sendStatus(200);
		} else {
			res.sendStatus(403);
		}
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error authenticating device for VPN', { req });
		res.status(500).send(translateError(err));
	}
};
export const clientConnect = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = req.body || {};
	if (!body.common_name) {
		res.sendStatus(400);
		return;
	}
	if (!body.virtual_address) {
		res.sendStatus(400);
		return;
	}
	if (!body.service_id) {
		res.sendStatus(400);
		return;
	}

	try {
		await clientConnectQuery()(
			{ uuid: body.common_name },
			{
				vpn_address: body.virtual_address,
				is_managed_by__service_instance: body.service_id,
			},
			{ req },
		);
		res.sendStatus(200);
	} catch (err) {
		captureException(err, 'Error with vpn client connect', { req });
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
	const body = req.body || {};
	if (!body.common_name) {
		res.sendStatus(400);
		return;
	}
	if (!body.service_id) {
		res.sendStatus(400);
		return;
	}

	try {
		await clientDisconnectQuery()(
			{ uuid: body.common_name, serviceId: body.service_id },
			undefined,
			{ req },
		);
		res.sendStatus(200);
	} catch (err) {
		captureException(err, 'Error with vpn client disconnect', { req });
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(500).send(translateError(err));
	}
};
