import type { Request, Response } from 'express';
import _ from 'lodash';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';

import type { Device } from '../../balena-model';
import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../infra/error-handling';

import {
	API_VPN_SERVICE_API_KEY,
	VPN_CONNECT_PROXY_PORT,
} from '../../lib/config';
import axios, { AxiosResponse as RequestResponse, AxiosInstance } from 'axios';
import tunnel from 'tunnel';
import { checkInt, throttledForEach } from '../../lib/utils';

// Degraded network, slow devices, compressed docker binaries and any combination of these factors
// can cause proxied device requests to surpass the default timeout.
const DEVICE_REQUEST_TIMEOUT = 50000;

const DELAY_BETWEEN_DEVICE_REQUEST = 50;

const { BadRequestError, NotFoundError } = errors;
const { api } = sbvrUtils;

const badSupervisorResponse = (
	req: Request,
	res: Response,
	filter: Filter,
	reason: string,
) => {
	// Log incident!
	const err = new Error(
		`${reason} (device: ${JSON.stringify(filter)}) (url: ${req.originalUrl})`,
	);
	captureException(err, 'Received invalid supervisor response', { req });
	res.status(500).json({ error: 'Bad API response from supervisor' });
};

const validateSupervisorResponse = (
	response: RequestResponse,
	req: Request,
	res: Response,
	filter: Filter,
) => {
	const { status: statusCode, headers, data } = response;
	const contentType = headers?.['content-type'];
	if (contentType != null) {
		if (/^application\/json/i.test(contentType)) {
			let jsonBody;
			if (_.isObject(data)) {
				jsonBody = data;
			} else {
				try {
					jsonBody = JSON.parse(data);
				} catch (e) {
					return badSupervisorResponse(req, res, filter, 'Invalid JSON data');
				}
			}
			res.status(statusCode).json(jsonBody);
		} else if (/^text\/(plain|html)/.test(contentType)) {
			if (/^([A-Za-z0-9\s:'.?!,/-])*$/g.test(data)) {
				res.status(statusCode).set('Content-Type', 'text/plain').send(data);
			} else {
				badSupervisorResponse(req, res, filter, 'Invalid TEXT data');
			}
		} else {
			badSupervisorResponse(
				req,
				res,
				filter,
				'Invalid content-type: ' + contentType,
			);
		}
	} else {
		res.status(statusCode).end();
	}
};

const multiResponse = (responses: RequestResponse[]) =>
	responses.map((response) => _.pick(response, 'statusCode', 'body'));

export const proxy = async (req: Request, res: Response) => {
	const filter: Filter = {};
	try {
		const url = req.params[0];
		if (url == null) {
			throw new BadRequestError('Supervisor API url must be specified');
		}

		const { appId, deviceId, uuid, data, method } = req.body;

		// Only check the validity of ids if they exist.
		if (appId != null) {
			filter.belongs_to__application = checkInt(appId);
			if (filter.belongs_to__application === false) {
				throw new BadRequestError(
					'App ID must be a valid integer if specified',
				);
			}
		}
		if (deviceId != null) {
			filter.id = checkInt(deviceId);
			if (filter.id === false) {
				throw new BadRequestError(
					'Device ID must be a valid integer if specified',
				);
			}
		}
		if (uuid != null) {
			if (typeof uuid !== 'string') {
				throw new BadRequestError('UUID must be a valid string if specified');
			}
			filter.uuid = uuid;
		}

		// Make sure at least one id has been set (filter isn't empty), and that the values for it are valid
		if (_.isEmpty(filter)) {
			throw new BadRequestError('At least one filter must be specified');
		}

		const responses = await requestDevices({ url, req, filter, data, method });
		if (responses.length === 1) {
			return validateSupervisorResponse(responses[0], req, res, filter);
		}
		res.status(207).json(multiResponse(responses));
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		const errorToReturn = err?.body ?? err;
		res.status(502).send(translateError(errorToReturn));
	}
};

interface FixedMethodRequestDevicesOpts {
	url: string;
	filter: Filter;
	data?: AnyObject;
	req?: sbvrUtils.Passthrough['req'];
	wait?: boolean;
}

interface RequestDevicesOpts extends FixedMethodRequestDevicesOpts {
	method: string;
}

// - req is the express req object, if passed then(the permissions of the user making
// the request will be used to get devices,
// if it is not passed then("guest" permissions will be used to get the devices.
// - method is the HTTP method for the request, defaults to 'POST'
async function requestDevices(
	opts: RequestDevicesOpts & {
		wait?: true;
	},
): Promise<RequestResponse[]>;
async function requestDevices(
	opts: RequestDevicesOpts & {
		wait: false;
	},
): Promise<void>;
// This override is identical to the main form in order for `postDevices` to be able
// to call it with the generic form
async function requestDevices(
	opts: RequestDevicesOpts,
): Promise<void | RequestResponse[]>;
async function requestDevices({
	url,
	filter,
	data,
	req,
	wait = true,
	method = 'POST',
}: RequestDevicesOpts): Promise<void | RequestResponse[]> {
	if (url == null) {
		throw new BadRequestError('You must specify a url to request!');
	}
	method = method.toUpperCase();
	if (!['PUT', 'PATCH', 'POST', 'HEAD', 'DELETE', 'GET'].includes(method)) {
		throw new BadRequestError(`Invalid method '${method}'`);
	}
	const devices = await sbvrUtils.db.readTransaction(async (tx) => {
		const resinApi = api.resin.clone({
			passthrough: { req, tx },
		});
		const deviceIds = (
			(await resinApi.get({
				resource: 'device',
				options: {
					$select: 'id',
					$filter: {
						$and: [
							{
								is_connected_to_vpn: true,
								is_frozen: false,
							},
							filter,
						],
					},
				},
			})) as Array<Pick<Device, 'id'>>
		).map(({ id }) => id);
		if (deviceIds.length === 0) {
			if (!wait) {
				// Don't throw an error if it's a fire/forget
				return [];
			}
			throw new NotFoundError('No online device(s) found');
		}
		// Check for device update permission, except for
		// internal operation of the platform.
		if (method !== 'GET' && req !== permissions.root) {
			await Promise.all(
				deviceIds.map(async (deviceId) => {
					const res = (await resinApi.post({
						url: `device(${deviceId})/canAccess`,
						body: { action: 'update' },
					})) as { d?: Array<{ id: number }> };

					if (res?.d?.[0]?.id !== deviceId) {
						throw new errors.ForbiddenError();
					}
				}),
			);
		}
		// And now fetch device data with full privs
		return await api.resin.get({
			resource: 'device',
			passthrough: { req: permissions.root, tx },
			options: {
				$select: ['api_port', 'api_secret', 'uuid'],
				$expand: {
					is_managed_by__service_instance: { $select: 'ip_address' },
				},
				$filter: {
					id: { $in: deviceIds },
					is_managed_by__service_instance: {
						$any: {
							$alias: 'si',
							$expr: { si: { ip_address: { $ne: null } } },
						},
					},
				},
			},
		});
	});

	// We add a delay between each notification so that we do not in essence
	// trigger a DDOS from balena devices against us, but we do not wait for
	// completion of individual requests because doing so could cause a
	// terrible UX if we have a device time out, as that would block all the
	// subsequent notifications
	const waitPromise = throttledForEach(
		devices,
		DELAY_BETWEEN_DEVICE_REQUEST,
		async (device) => {
			let vpnIp = device.is_managed_by__service_instance[0].ip_address;
			if (vpnIp.includes(':')) {
				vpnIp = `[${vpnIp}]`;
			}
			const deviceUrl = `http://${device.uuid}.balena:${
				device.api_port || 80
			}${url}?apikey=${device.api_secret}`;
			try {
				const agent = tunnel.httpsOverHttp({
					proxy: {
						host: `http://resin_api:${API_VPN_SERVICE_API_KEY}@${vpnIp}`,
						port: VPN_CONNECT_PROXY_PORT,
					},
				});
				const axiosClient: AxiosInstance = axios.create({
					httpsAgent: agent,
					proxy: false,
				});
				const test = await axiosClient({
					method,
					data,
					url: deviceUrl,
					timeout: DEVICE_REQUEST_TIMEOUT,
				});
				console.log(`test:${JSON.stringify(test, null, 2)}`);
				return test;
			} catch (err) {
				if (!wait) {
					// If we don't care about waiting for the request then we just ignore the error and continue
					return;
				}
				throw err;
			}
		},
	);

	if (!wait) {
		return;
	}
	// We cast away the undefined because that can only happen if wait == false which we handle above
	return (await waitPromise) as RequestResponse[];
}

export async function postDevices(
	opts: FixedMethodRequestDevicesOpts & {
		wait?: true;
	},
): Promise<RequestResponse[]>;
export async function postDevices(
	opts: FixedMethodRequestDevicesOpts & {
		wait: false;
	},
): Promise<void>;
export async function postDevices(
	opts: FixedMethodRequestDevicesOpts,
): Promise<void | RequestResponse[]> {
	return await requestDevices({ ...opts, method: 'POST' });
}
