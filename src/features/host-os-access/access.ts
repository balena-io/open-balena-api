import type { Request, Response } from 'express';

import { sbvrUtils, errors } from '@balena/pinejs';
import * as semver from 'balena-semver';

import { reqHasPermission } from '../../infra/auth/auth.js';
import { captureException } from '../../infra/error-handling/index.js';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

const HOSTOS_ACCESS_MIN_OS_VER = '2.0.0';

export async function hostOSAccess(req: Request, res: Response): Promise<void> {
	const device = await api.resin.get({
		resource: 'device',
		id: {
			uuid: req.params['device_uuid'],
		},
		options: {
			$select: ['id', 'os_version'],
		},
		passthrough: {
			req,
		},
	});

	if (device == null) {
		res.status(401).end();
		return;
	}

	try {
		const allowedDevices = (await api.resin.request({
			method: 'POST',
			url: `device(${device.id})/canAccess`,
			passthrough: {
				req,
			},
			body: {
				action: 'ssh-host',
			},
		})) as { d?: Array<{ id: number }> };

		if (!Array.isArray(allowedDevices.d) || allowedDevices.d.length !== 1) {
			res.status(401).end();
			return;
		}

		const allowedDevice = allowedDevices.d[0];

		if (allowedDevice.id !== device.id) {
			res.status(401).end();
			return;
		}

		// Support agents and admins are allowed to access hostOS of every device they can read
		if (
			reqHasPermission(req, 'support.home') ||
			reqHasPermission(req, 'admin.home')
		) {
			res.status(200).end();
			return;
		}

		// Users are allowed to access hostOS for devices with version >= HOSTOS_ACCESS_MIN_OS_VER or if the version is still unknown
		if (
			!device.os_version ||
			semver.gte(device.os_version, HOSTOS_ACCESS_MIN_OS_VER)
		) {
			res.status(200).end();
			return;
		}

		// Users are not allowed to access hostOS for devices with balenaOS < HOSTOS_ACCESS_MIN_OS_VER
		res.status(401).end();
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			// Users are not allowed to access hostOS for devices with balenaOS < HOSTOS_ACCESS_MIN_OS_VER
			res.status(401).end();
			return;
		}

		captureException(err, 'Error checking hostOS access', { req });
		res.status(401).end();
	}
}
