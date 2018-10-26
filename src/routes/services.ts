import * as Promise from 'bluebird';
import { Request, Response } from 'express';
import { resinApi } from '../platform';
import { captureException, handleHttpErrors } from '../platform/errors';

export const vpn = {
	authDevice: (req: Request, res: Response): void | Promise<void> =>
		resinApi
			.get({
				resource: 'device',
				passthrough: { req },
				options: {
					$select: ['id'],
					$filter: {
						uuid: req.param('device_uuid'),
					},
				},
			})
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

		return resinApi
			.patch({
				resource: 'device',
				passthrough: { req },
				options: {
					$filter: {
						uuid: body.common_name,
					},
				},
				body: {
					is_connected_to_vpn: true,
					vpn_address: body.virtual_address,
					is_managed_by__service_instance: body.service_id,
				},
			})
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

		return resinApi
			.patch({
				resource: 'device',
				passthrough: { req },
				options: {
					$filter: {
						uuid: body.common_name,
						// Only disconnect if still managed by this vpn
						is_managed_by__service_instance: body.service_id,
					},
				},
				body: {
					is_connected_to_vpn: false,
					vpn_address: null,
				},
			})
			.then(() => {
				res.sendStatus(200);
			})
			.catch(err => {
				captureException(err, 'Error with vpn client disconnect', { req });
				res.status(500).send(err);
			});
	},
};
