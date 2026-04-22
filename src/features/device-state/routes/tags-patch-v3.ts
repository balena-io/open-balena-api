import type { RequestHandler } from 'express';

import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';
import { sbvrUtils, errors } from '@balena/pinejs';
import { getIP } from '../../../lib/utils.js';
import type { DeviceTag } from '../../../balena-model.js';
import type { ResolveDeviceInfoCustomObject } from '../middleware.js';
import { checkTagKeyValidity } from '../../tags/validation.js';
import { resolveDeviceUuids } from './state-patch-v3.js';

const { BadRequestError, UnauthorizedError } = errors;
const { api } = sbvrUtils;

/**
 * These typings should be used as a guide to what should be sent, but cannot be trusted as what actually *is* sent.
 */
export type TagsPatchV3Body = {
	[uuid: string]: {
		[tagKey: string]: string;
	};
};

const fetchData = async (
	req: Express.Request,
	custom: AnyObject,
	deviceIds: number[],
	deviceTagKeys: {
		[deviceUuid: string]: string[];
	},
) =>
	await sbvrUtils.db.readTransaction(async (tx) => {
		const resinApiTx = api.resin.clone({
			passthrough: { req, custom, tx },
		});
		const devices = await resinApiTx.get({
			resource: 'device',
			options: {
				$select: ['id', 'uuid'],
				$filter: {
					id: { $in: deviceIds },
				},
			},
		} as const);
		if (devices.length !== deviceIds.length) {
			throw new UnauthorizedError();
		}

		const tagsByDevice: {
			[deviceUuid: string]: {
				id: number;
				tags: Record<DeviceTag['Read']['tag_key'], DeviceTag['Read']['value']>;
			};
		} = {};
		for (const { id, uuid } of devices) {
			tagsByDevice[uuid] = {
				id,
				tags: Object.fromEntries(
					(
						await resinApiTx.get({
							resource: 'device_tag',
							options: {
								$select: ['tag_key', 'value'],
								$filter: {
									device: id,
									tag_key: { $in: deviceTagKeys[uuid] },
								},
							},
						} as const)
					).map(({ tag_key, value }) => [tag_key, value]),
				),
			};
		}

		return tagsByDevice;
	});

export const tagsPatchV3: RequestHandler = async (req, res) => {
	try {
		const body = req.body as TagsPatchV3Body;
		const custom: AnyObject = {}; // shove custom values here to make them available to the hooks

		// forward the public ip address if the request is from the supervisor.
		if (req.apiKey != null) {
			custom.ipAddress = getIP(req);
		}

		const uuids = resolveDeviceUuids(body);
		if (uuids.length === 0) {
			throw new BadRequestError();
		}
		const { resolvedDeviceIds } = req.custom as ResolveDeviceInfoCustomObject;

		const deviceTagKeys: Parameters<typeof fetchData>[3] = {};
		for (const uuid of uuids) {
			if (body[uuid] == null || typeof body[uuid] !== 'object') {
				throw new BadRequestError();
			}

			const tagKeys = Object.keys(body[uuid]);
			if (tagKeys.length > 0) {
				for (const tagKey of tagKeys) {
					checkTagKeyValidity(tagKey);
					if (typeof body[uuid][tagKey] !== 'string') {
						throw new BadRequestError('Tag values must be strings.');
					}
				}

				deviceTagKeys[uuid] = tagKeys;
			}
		}
		if (Object.keys(deviceTagKeys).length === 0) {
			throw new BadRequestError('No tags were sent to be updated.');
		}
		const tagsByDevice = await fetchData(
			req,
			custom,
			resolvedDeviceIds,
			deviceTagKeys,
		);

		const updateFns: Array<
			(resinApiTx: typeof sbvrUtils.api.resin) => Promise<void>
		> = [];

		for (const uuid of uuids) {
			const tags = body[uuid];
			const tagKeys = deviceTagKeys[uuid];
			if (tagKeys == null || tagKeys.length === 0) {
				continue;
			}

			const deviceId = tagsByDevice[uuid].id;
			const existingTags = tagsByDevice[uuid].tags;

			const updatedKeys: string[] = [];
			const newKeys: string[] = [];
			for (const tagKey of tagKeys) {
				const tagValue = tags[tagKey];
				const existingTagValue = existingTags[tagKey];
				if (existingTagValue == null) {
					newKeys.push(tagKey);
				} else if (existingTagValue !== tagValue) {
					updatedKeys.push(tagKey);
				}
				// No need to update if the key exists and value is the same
			}
			updateFns.push(async (resinApiTx) => {
				await Promise.all([
					...updatedKeys.map(async (key) => {
						await resinApiTx.patch({
							resource: 'device_tag',
							id: {
								device: deviceId,
								tag_key: key,
							},
							body: { value: tags[key] },
						} as const);
					}),
					...newKeys.map(async (key) => {
						await resinApiTx.post({
							resource: 'device_tag',
							body: {
								device: deviceId,
								tag_key: key,
								value: tags[key],
							},
						} as const);
					}),
				]);
			});
		}

		if (updateFns.length > 0) {
			await sbvrUtils.db.transaction(async (tx) => {
				const resinApiTx = api.resin.clone({
					passthrough: { req, custom, tx },
				});

				await Promise.all(updateFns.map((fn) => fn(resinApiTx)));
			});
		}

		res.status(200).end();
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error setting device tags');
		res.sendStatus(500);
	}
};
