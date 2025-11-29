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
import { checkDeviceExistsIsFrozen } from '../device-state/middleware.js';
import onFinished from 'on-finished';
import type { Device } from '../../balena-model.js';
import { normalizeDeviceWriteBody } from '../device-state/state-patch-utils.js';

const { BadRequestError, ConflictError } = errors;
const { api } = sbvrUtils;

type RegisterRequest = {
	uuid: string;
	device_type: string;
	supervisor_version?: string;
	os_version?: string;
	os_variant?: string;
	mac_address?: string;

	// optional Map<AppUuid, ReleaseId> to pin the device to
	releases?: Record<string, string>;

	// optional Map<ConfigVarKey, Value> to insert
	config?: Record<string, string>;
};

export const register: RequestHandler = async (req, res) => {
	try {
		const body = req.body as RegisterRequest;

		const deviceTypeSlug = body.device_type;
		if (deviceTypeSlug == null) {
			throw new BadRequestError('Device type must be specified');
		}

		const uuid = body.uuid;
		if (uuid == null) {
			throw new BadRequestError('UUID must be specified');
		}

		const {
			supervisor_version: supervisorVersion,
			os_version: osVersion,
			os_variant: osVariant,
			mac_address: macAddress,
			releases: _releases = {},
			config: deviceConfig = {},
		} = body;

		// validate device config vars
		for (const key of deviceConfig) {
			if (!key.startswith('RESIN_') && !key.startswith('BALENA_')) {
				throw new BadRequestError(`Invalid config key: ${key}`);
			}
		}

		const deviceApiKey = randomstring.generate();

		const response = await sbvrUtils.db.transaction(async (tx) => {
			// TODO: Replace this manual rollback on request closure with a more generic/automated version
			onFinished(res, () => {
				if (!tx.isClosed()) {
					void tx.rollback();
				}
			});

			// Using the provisioning key's permissions, fetch all fleets that
			// that are accessible to it. The only valid result is *one fleet*.
			// Otherwise, either the provisioning key was linked to more than one
			// actor, or the actor was linked to more than one fleet, or
			// the actor isn't linked to an fleet at all. Currently these
			// are all invalid/inconsistent states for the database to be in.
			const fleets = await api.resin.clone({ passthrough: { req, tx } }).get({
				resource: 'application', // FIXME: should be fleet
				options: {
					$select: 'id',
					$top: 2, // we need to fail if there's more than one but also guard against fetching the whole db
				}
			});
			if (fleets.length !== 1) {
				// this shouldn't happen as per above.
				// FIXME: need a better error type than BadRequest so that it is reported to Sentry
				throw new BadRequestError('Invalid provisioning API key');
			}
			const fleetId = fleets[0].id;

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

			const resinApiTx = api.resin.clone({ passthrough: { req, tx } });
			const deviceType = await getDeviceTypeBySlug(resinApiTx, deviceTypeSlug);
			const deviceBody = {
				belongs_to__application: fleetId,
				is_of__device_type: deviceType.id,
				supervisor_version: supervisorVersion,
				os_version: osVersion,
				os_variant: osVariant,
				mac_address: macAddress,
				uuid,
			} satisfies Partial<Device['Write']>;
			const device = await resinApiTx.post({
				resource: 'device',
				body: normalizeDeviceWriteBody(deviceBody, uuid),
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
		captureException(err, 'Error registering device');
		res.status(403).send(translateError(err));
	}
};
