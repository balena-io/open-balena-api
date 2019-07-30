import * as Promise from 'bluebird';
import { Request, Response } from 'express';
import { resinApi } from '../platform';
import { captureException, handleHttpErrors } from '../platform/errors';

const authQuery = resinApi.prepare<{ uuid: string }>({
	resource: 'device',
	options: {
		$select: 'id',
		$filter: {
			uuid: { '@': 'uuid' },
		},
	},
});
const clientConnectQuery = resinApi.prepare<{ uuid: string }>({
	method: 'PATCH',
	resource: 'device',
	options: {
		$filter: {
			uuid: { '@': 'uuid' },
		},
	},
	body: {
		is_connected_to_vpn: true,
	},
});
const clientDisconnectQuery = resinApi.prepare<{
	uuid: string;
	serviceId: number;
}>({
	method: 'PATCH',
	resource: 'device',
	options: {
		$filter: {
			uuid: { '@': 'uuid' },
			// Only disconnect if still managed by this vpn
			is_managed_by__service_instance: { '@': 'serviceId' },
		},
	},
	body: {
		is_connected_to_vpn: false,
		vpn_address: null,
	},
});
export const vpn = {
	authDevice: (req: Request, res: Response): void | Promise<void> =>
		authQuery({ uuid: req.param('device_uuid') }, undefined, { req })
			.then(([device]: AnyObject[]) => {
				// for now, if the api key is able to read the device,
				// it has vpn access
				if (device) {
					res.sendStatus(200);
				} else {
					res.sendStatus(403);
				}
			})
			.catch(err => {
				if (handleHttpErrors(req, res, err)) {
					return;
				}
				captureException(err, 'Error authenticating device for VPN', { req });
				res.status(500).send(err);
			}),
	clientConnect: (req: Request, res: Response): void | Promise<void> => {
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

		return clientConnectQuery(
			{ uuid: body.common_name },
			{
				vpn_address: body.virtual_address,
				is_managed_by__service_instance: body.service_id,
			},
			{ req },
		)
			.then(() => {
				res.sendStatus(200);
			})
			.catch(err => {
				captureException(err, 'Error with vpn client connect', { req });
				res.status(500).send(err);
			});
	},

	clientDisconnect: (req: Request, res: Response): void | Promise<void> => {
		const body = req.body || {};
		if (!body.common_name) {
			res.sendStatus(400);
			return;
		}
		if (!body.service_id) {
			res.sendStatus(400);
			return;
		}

		return clientDisconnectQuery(
			{ uuid: body.common_name, serviceId: body.service_id },
			undefined,
			{ req },
		)
			.then(() => {
				res.sendStatus(200);
			})
			.catch(err => {
				captureException(err, 'Error with vpn client disconnect', { req });
				res.status(500).send(err);
			});
	},
};
