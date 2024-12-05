import type { RequestHandler } from 'express';
import randomstring from 'randomstring';
import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling/index.js';

import {
	augmentReqApiKeyPermissions,
	createDeviceApiKey,
} from '../api-keys/lib.js';
import { getDeviceTypeBySlug } from '../device-types/device-types.js';
import { checkInt } from '../../lib/utils.js';
import { checkDeviceExistsIsFrozen } from '../device-state/middleware.js';
import { gracefullyDenyConflictingRegistrations } from './gracefully-deny-conflicting-registrations.js';
import onFinished from 'on-finished';
import type { Device } from '../../balena-model.js';

const { BadRequestError, ConflictError } = errors;
const { api } = sbvrUtils;

export const register: RequestHandler = async (req, res) => {
	try {
		const userId = req.body.user == null ? null : checkInt(req.body.user);
		if (userId === false) {
			throw new BadRequestError('User ID must be a valid integer');
		}

		const applicationId = checkInt(req.body.application);
		if (applicationId === false) {
			throw new BadRequestError('Application ID must be a valid integer');
		}

		const deviceTypeSlug = req.body.device_type;
		if (deviceTypeSlug == null) {
			throw new BadRequestError('Device type must be specified');
		}

		const uuid = req.body.uuid;
		if (uuid == null) {
			throw new BadRequestError('UUID must be specified');
		}

		await gracefullyDenyConflictingRegistrations(uuid, req.body.api_key);

		const {
			supervisor_version: supervisorVersion,
			os_version: osVersion,
			os_variant: osVariant,
			mac_address: macAddress,
		} = req.body;
		const deviceApiKey = req.body.api_key ?? randomstring.generate();

		/**
		 * Temporarily augment the api key with the ability to:
		 * - Fetch the device we create & create an api key for it
		 * - Read the hostApp releases that should be operating the device
		 */
		req = augmentReqApiKeyPermissions(req, [
			'resin.device.read',
			'resin.device.create-device-api-key',
			`resin.application.read?is_public eq true and is_host eq true and is_for__device_type/canAccess()`,
			'resin.release.read?belongs_to__application/canAccess()',
			`resin.release_tag.read?release/canAccess()`,
		]);

		const response = await sbvrUtils.db.transaction(async (tx) => {
			// TODO: Replace this manual rollback on request closure with a more generic/automated version
			onFinished(res, () => {
				if (!tx.isClosed()) {
					void tx.rollback();
				}
			});

			const resinApiTx = api.resin.clone({ passthrough: { req, tx } });
			const deviceType = await getDeviceTypeBySlug(resinApiTx, deviceTypeSlug);
			const device = await resinApiTx.post({
				resource: 'device',
				body: {
					// @ts-expect-error This is for backwards compatibility :(
					belongs_to__user: userId,
					belongs_to__application: applicationId,
					is_of__device_type: deviceType.id,
					supervisor_version: supervisorVersion,
					os_version: osVersion,
					os_variant: osVariant,
					mac_address: macAddress,
					uuid,
				} satisfies Partial<Device['Write']> as Partial<Device['Write']>,
			});
			if (device == null) {
				throw new Error('Failed to create device');
			}
			const apiKey = await createDeviceApiKey(req, device.id, {
				tx,
				apiKey: deviceApiKey,
				name: null,
				description: null,
				expiryDate: null,
			});
			return {
				id: device.id,
				uuid: device.uuid,
				api_key: apiKey,
			};
		});

		// Clear the device existence cache for the just registered device
		// in case it tried to communicate with the API before registering
		void checkDeviceExistsIsFrozen.delete(response.uuid);

		res.status(201).json(response);
	} catch (err) {
		if (err instanceof ConflictError && err.message.includes('uuid')) {
			// WORKAROUND: balena-supervisor >= v4.2.0 < v11.4.14 rely on the specific error message rather than a 409
			// so we convert the error here to ensure they can continue to work, this should be removed once we drop
			// support for those supervisor versions
			res.status(err.status).send('"uuid" must be unique.');
			return;
		}
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error registering device', { req });
		res.status(403).send(translateError(err));
	}
};
