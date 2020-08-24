import type { RequestHandler } from 'express';
import * as _ from 'lodash';
import * as randomstring from 'randomstring';

import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling';

import { isValidInteger } from '../../lib/utils';

const { BadRequestError } = errors;
const { api } = sbvrUtils;

// This endpoint takes an array containing the local_id's of all the
// dependent devices discovered by a gateway device and decides what to do for each one.
// The main aim is to ensure that a dependent device can only ever be managed
// by one gateway at any one time.
//
// This endpoint will:
// If the dependent device does not already exist it will be provisioned.
// If an existing managed dependent device is not in the array it will be set as unmanaged.
// If an existing dependent device is in the array and unmanaged it will be managed by this gateway.
// If a dependent device is in the array and is already managed by this gateway the
// is_locked_until__date will be updated.
// If a dependent device is in the array and is already managed by a different gateway
// then nothing is done.
//
// A dependent device is unmanaged if: is_managed_by__device = null OR
// is_locked_until__date = null OR is_locked_until__date = expired
// A dependent device is managed if: is_managed_by__device != null AND
// is_locked_until__date > now
export const receiveOnlineDependentDevices: RequestHandler = async (
	req,
	res,
) => {
	try {
		const {
			user,
			gateway,
			dependent_app,
			dependent_device_type,
			online_dependent_devices,
			expiry_date,
		} = req.body;
		if (user != null && !isValidInteger(user)) {
			throw new BadRequestError('user not found or invalid');
		}
		if (!isValidInteger(gateway)) {
			throw new BadRequestError('gateway not found or invalid');
		}
		if (!isValidInteger(dependent_app)) {
			throw new BadRequestError('dependent_app not found or invalid');
		}
		if (
			dependent_device_type == null ||
			_.isEmpty(dependent_device_type) ||
			typeof dependent_device_type !== 'string'
		) {
			throw new BadRequestError('dependent_device_type not found or invalid');
		}
		if (
			online_dependent_devices == null ||
			!Array.isArray(online_dependent_devices) ||
			online_dependent_devices.some((localId) => typeof localId !== 'string')
		) {
			throw new BadRequestError(
				'online_dependent_devices not found or invalid',
			);
		}
		if (!isValidInteger(expiry_date)) {
			throw new BadRequestError('expiry_date not found or invalid');
		}

		await sbvrUtils.db.transaction(async (tx) => {
			const resinApiTx = api.resin.clone({ passthrough: { tx, req } });

			if (online_dependent_devices.length > 0) {
				// Get all dependent devices matching those we're receiving,
				// so we can figure out which need to be provisioned
				const devices = (await resinApiTx.get({
					resource: 'device',
					options: {
						$select: 'local_id',
						$filter: {
							belongs_to__application: dependent_app,
							local_id: { $in: online_dependent_devices },
						},
					},
				})) as Array<{ local_id: string }>;
				// Get the local_id for each dependent device that needs to be provisioned
				const toBeProvisioned = _.difference(
					online_dependent_devices,
					devices.map(({ local_id }) => local_id),
				);
				await Promise.all(
					toBeProvisioned.map(async (localId) => {
						// Provision new dependent devices
						await resinApiTx.post({
							resource: 'device',
							body: {
								uuid: randomstring.generate({ length: 62, charset: 'hex' }),
								belongs_to__user: user,
								belongs_to__application: dependent_app,
								device_type: dependent_device_type,
								local_id: localId,
								logs_channel: randomstring.generate({
									length: 62,
									charset: 'hex',
								}),
							},
							options: { returnResource: false },
						});
					}),
				);
			}
			// Set all dependent devices currently being managed by
			// this gateway to unmanaged
			await resinApiTx.patch({
				resource: 'device',
				options: {
					$filter: {
						is_managed_by__device: gateway,
						belongs_to__application: dependent_app,
					},
				},
				body: {
					is_managed_by__device: null,
					is_locked_until__date: null,
					is_online: false,
				},
			});

			if (online_dependent_devices.length > 0) {
				// Set all dependent devices that are in online_dependent_devices
				// and unmanaged to managed
				await resinApiTx.patch({
					resource: 'device',
					options: {
						$filter: {
							local_id: { $in: online_dependent_devices },
							belongs_to__application: dependent_app,
							$or: [
								{
									is_managed_by__device: null,
								},
								{
									is_locked_until__date: null,
								},
								{
									is_locked_until__date: { $le: { $now: {} } },
								},
							],
						},
					},
					body: {
						is_managed_by__device: gateway,
						is_locked_until__date: expiry_date,
						is_online: true,
					},
				});
			}

			res.sendStatus(200);
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error handling dependent device scan', { req });
		res.status(403).send(translateError(err));
	}
};
