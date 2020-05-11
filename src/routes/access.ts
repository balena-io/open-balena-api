import type { Request, Response } from 'express';

import { sbvrUtils } from '@resin/pinejs';
import * as semver from 'balena-semver';

import { reqHasPermission } from '../platform/auth';
import { captureException } from '../platform/errors';

const { UnauthorizedError, api } = sbvrUtils;

const HOSTOS_ACCESS_MIN_OS_VER = '2.0.0';

export async function hostOSAccess(req: Request, res: Response): Promise<void> {
	const devices = await api.resin.get({
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
	});

	if (!Array.isArray(devices)) {
		res.sendStatus(401);
		return;
	}

	if (devices.length !== 1) {
		res.sendStatus(401);
		return;
	}

	const [device] = devices;

	try {
		const allowedDevices = (await api.resin.post({
			resource: 'device',
			id: device.id,
			passthrough: {
				req,
			},
			body: {
				action: 'ssh-host',
			},
			url: `device(${device.id})/canAccess`,
		})) as { d?: AnyObject[] };

		if (!Array.isArray(allowedDevices.d) || allowedDevices.d.length !== 1) {
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

		// Users are allowed to access hostOS for devices with version >= HOSTOS_ACCESS_MIN_OS_VER or if the version is still unknown
		if (
			!device.os_version ||
			semver.gte(device.os_version, HOSTOS_ACCESS_MIN_OS_VER)
		) {
			res.sendStatus(200);
			return;
		}

		// Users are not allowed to access hostOS for devices with balenaOS < HOSTOS_ACCESS_MIN_OS_VER
		res.sendStatus(401);
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			// Users are not allowed to access hostOS for devices with balenaOS < HOSTOS_ACCESS_MIN_OS_VER
			res.sendStatus(401);
			return;
		}

		captureException(err, 'Error checking hostOS access', { req });
		res.sendStatus(401);
	}
}
