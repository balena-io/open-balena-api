import * as express from 'express';
import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as rSemver from 'resin-semver';
import { reqHasPermission } from '../platform/auth';
import { resinApi, sbvrUtils } from '../platform';
import { captureException } from '../platform/errors';

const { UnauthorizedError } = sbvrUtils;

const HOSTOS_ACCESS_MIN_RESINOS_VER = '2.0.0';

export function hostOSAccess(
	req: express.Request,
	res: express.Response,
): Promise<void> {
	return resinApi
		.get({
			resource: 'device',
			options: {
				$select: ['id', 'os_version'],
				$filter: {
					uuid: req.params['device_uuid'],
				},
			},
			passthrough: {
				req,
			},
		})
		.then(devices => {
			if (!_.isArray(devices)) {
				res.sendStatus(401);
				return;
			}

			if (devices.length !== 1) {
				res.sendStatus(401);
				return;
			}

			const device = devices[0];

			return resinApi
				.post({
					resource: 'device',
					id: device.id,
					passthrough: {
						req,
					},
					body: {
						action: 'ssh-host',
					},
					url: `device(${device.id})/canAccess`,
				})
				.then((allowedDevices: any) => {
					if (
						allowedDevices.d == null ||
						!_.isArray(allowedDevices.d) ||
						allowedDevices.d.length !== 1
					) {
						res.sendStatus(401);
						return;
					}

					const allowedDevice = allowedDevices.d[0];

					if (allowedDevice.id !== device.id) {
						res.sendStatus(401);
						return;
					}

					// Support agents and admins are allowed to access hostOS of every device they can read
					if (
						reqHasPermission(req, 'support.home') ||
						reqHasPermission(req, 'admin.home')
					) {
						res.sendStatus(200);
						return;
					}

					// Users are allowed to access hostOS for devices with resinOS >= HOSTOS_ACCESS_MIN_RESINOS_VER
					if (rSemver.gte(device.os_version, HOSTOS_ACCESS_MIN_RESINOS_VER)) {
						res.sendStatus(200);
						return;
					}

					// Users are not allowed to access hostOS for devices with resinOS < HOSTOS_ACCESS_MIN_RESINOS_VER
					res.sendStatus(401);
				})
				.catch((err: any) => {
					if (err instanceof UnauthorizedError) {
						// Users are not allowed to access hostOS for devices with resinOS < HOSTOS_ACCESS_MIN_RESINOS_VER
						res.sendStatus(401);
						return;
					}

					captureException(err, 'Error checking hostOS access', { req });
					res.sendStatus(401);
				});
		});
}
