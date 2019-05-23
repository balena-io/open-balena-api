import * as _ from 'lodash';
import * as Promise from 'bluebird';

import { NoDevicesFoundError } from '../lib/errors';
import {
	captureException,
	translateError,
	handleHttpErrors,
} from '../platform/errors';

import { checkInt } from './utils';
import { sbvrUtils } from '../platform';
import { Request, Response } from 'express';
import { PinejsClientCoreFactory } from 'pinejs-client-core';

import { resinApi, root } from '../platform';

import { RequestResponse, requestAsync } from './request';
import { API_VPN_SERVICE_API_KEY } from './config';

// Degraded network, slow devices, compressed docker binaries and any combination of these factors
// can cause proxied device requests to surpass the default timeout.
const DEVICE_REQUEST_TIMEOUT = 50000;

const DELAY_BETWEEN_DEVICE_REQUEST = 50;

const { BadRequestError } = sbvrUtils;

const badSupervisorResponse = (
	req: Request,
	res: Response,
	filter: PinejsClientCoreFactory.Filter,
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
	filter: PinejsClientCoreFactory.Filter,
) => {
	const [{ statusCode, headers }, body] = response;
	const contentType = headers != null ? headers['content-type'] : undefined;
	if (contentType != null) {
		if (/^application\/json/i.test(contentType)) {
			let jsonBody;
			if (_.isObject(body)) {
				jsonBody = body;
			} else {
				try {
					jsonBody = JSON.parse(body);
				} catch (e) {
					return badSupervisorResponse(req, res, filter, 'Invalid JSON data');
				}
			}
			res.status(statusCode).json(jsonBody);
		} else if (/^text\/(plain|html)/.test(contentType)) {
			if (/^([A-Za-z0-9\s:'\.\?!,\/-])*$/g.test(body)) {
				res
					.status(statusCode)
					.set('Content-Type', 'text/plain')
					.send(body);
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
	_.map(responses, ([response]) => _.pick(response, 'statusCode', 'body'));

export const proxy = (req: Request, res: Response) => {
	const filter: PinejsClientCoreFactory.Filter = {};
	return Promise.try(() => {
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
			if (!_.isString(uuid)) {
				throw new BadRequestError('UUID must be a valid string if specified');
			}
			filter.uuid = uuid;
		}

		// Make sure at least one id has been set (filter isn't empty), and that the values for it are valid
		if (_.isEmpty(filter)) {
			throw new BadRequestError('At least one filter must be specified');
		}

		return requestDevices({ url, req, filter, data, method });
	})
		.then(responses => {
			if (responses.length === 1) {
				return validateSupervisorResponse(responses[0], req, res, filter);
			}
			res.status(207).json(multiResponse(responses));
		})
		.catch(err => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			if (err != null && err.body != null) {
				err = err.body;
			}
			res.status(502).send(translateError(err));
		});
};

interface FixedMethodRequestDevicesOpts {
	url: string;
	filter: PinejsClientCoreFactory.Filter;
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
export function requestDevices(
	opts: RequestDevicesOpts & {
		wait?: true;
	},
): Promise<RequestResponse[]>;
export function requestDevices(
	opts: RequestDevicesOpts & {
		wait: false;
	},
): Promise<void>;
// This override is identical to the main form in order for `postDevices` to be able
// to call it with the generic form
export function requestDevices(
	opts: RequestDevicesOpts,
): Promise<void | RequestResponse[]>;
export function requestDevices({
	url,
	filter,
	data,
	req,
	wait = true,
	method = 'POST',
}: RequestDevicesOpts): Promise<void | RequestResponse[]> {
	if (url == null) {
		return Promise.reject(
			new BadRequestError('You must specify a url to request!'),
		);
	}
	method = method.toUpperCase();
	if (!['PUT', 'PATCH', 'POST', 'HEAD', 'DELETE', 'GET'].includes(method)) {
		return Promise.reject(new BadRequestError(`Invalid method '${method}'`));
	}
	return resinApi
		.get({
			resource: 'device',
			options: {
				$select: 'id',
				$filter: {
					$and: [
						{
							is_connected_to_vpn: true,
							vpn_address: { $ne: null },
						},
						filter,
					],
				},
			},
			passthrough: { req },
		})
		.then((devices: AnyObject[]) => {
			if (devices.length === 0) {
				if (!wait) {
					// Don't throw an error if it's a fire/forget
					return;
				}
				throw new NoDevicesFoundError('No online device(s) found');
			}
			// And now fetch device data with full privs
			return resinApi
				.get({
					resource: 'device',
					passthrough: { req: root },
					options: {
						$select: ['api_port', 'api_secret', 'uuid'],
						$expand: {
							is_managed_by__service_instance: { $select: 'ip_address' },
						},
						$filter: {
							id: { $in: _.map(devices, 'id') },
							is_managed_by__service_instance: {
								$any: {
									$alias: 'si',
									$expr: { si: { ip_address: { $ne: null } } },
								},
							},
						},
					},
				})
				.then<void | RequestResponse[]>((devices: AnyObject[]) => {
					const promises: Array<ReturnType<typeof requestAsync>> = [];
					const waitPromise = Promise.each(devices, device => {
						const vpnIp = device.is_managed_by__service_instance[0].ip_address;
						const deviceUrl = `http://${device.uuid}.balena:${device.api_port ||
							80}${url}?apikey=${device.api_secret}`;
						let p = requestAsync({
							uri: deviceUrl,
							json: data,
							proxy: `http://resin_api:${API_VPN_SERVICE_API_KEY}@${vpnIp}:3128`,
							tunnel: true,
							method,
							timeout: DEVICE_REQUEST_TIMEOUT,
						});
						if (!wait) {
							// this force-cast is super ugly but harmless because clearly noone
							// cares about the return value of the promise (since wait == false)
							// so we just need to satisfy the compiler
							p = p.catchReturn((undefined as any) as RequestResponse);
						}
						promises.push(p);
						// We add a delay between each notification so that we do not in essence
						// trigger a DDOS from resin devices against us, but we do not wait for
						// completion of individual requests because doing so could cause a
						// terrible UX if we have a device time out, as that would block all the
						// subsequent notifications
						return Promise.delay(DELAY_BETWEEN_DEVICE_REQUEST);
					}).then(() => Promise.all(promises));

					if (!wait) {
						// We return null if not waiting in order to stop bluebird warnings,
						// and we cast as void to keep the void typing (ie that the result
						// should not be used for this case)
						return (null as any) as void;
					}
					return waitPromise;
				});
		});
}

export function postDevices(
	opts: FixedMethodRequestDevicesOpts & {
		wait?: true;
	},
): Promise<RequestResponse[]>;
export function postDevices(
	opts: FixedMethodRequestDevicesOpts & {
		wait: false;
	},
): Promise<void>;
export function postDevices(
	opts: FixedMethodRequestDevicesOpts,
): Promise<void | RequestResponse[]> {
	return requestDevices({ ...opts, method: 'POST' });
}
