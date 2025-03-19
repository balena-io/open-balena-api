import type { RequestHandler } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';
import { sbvrUtils, errors } from '@balena/pinejs';
import { getIP } from '../../../lib/utils.js';
import type { Device } from '../../../balena-model.js';
import {
	shouldUpdateMetrics,
	metricsPatchFields,
	v2ValidPatchFields,
	upsertImageInstall,
	deleteOldImageInstalls,
	truncateShortTextFields,
	limitMetricNumbers,
} from '../state-patch-utils.js';
import type { ResolveDeviceInfoCustomObject } from '../middleware.js';

const { BadRequestError, UnauthorizedError } = errors;
const { api } = sbvrUtils;

type LocalBody = NonNullable<StatePatchV2Body['local']>;
/**
 * These typings should be used as a guide to what should be sent, but cannot be trusted as what actually *is* sent.
 */
export type StatePatchV2Body = {
	local?: {
		should_be_running__release?: number;
		name?: string;
		/**
		 * @deprecated in favor of name, to match the GET endpoint
		 */
		device_name?: string;
		status?: string;
		is_online?: boolean;
		note?: string;
		os_version?: string;
		os_variant?: string;
		supervisor_version?: string;
		provisioning_progress?: number | null;
		provisioning_state?: string | null;
		ip_address?: string;
		mac_address?: string;
		download_progress?: number | null;
		api_port?: number;
		api_secret?: string;
		memory_usage?: number;
		memory_total?: number;
		storage_block_device?: string;
		storage_usage?: number;
		storage_total?: number;
		cpu_temp?: number;
		cpu_usage?: number;
		cpu_id?: string;
		is_undervolted?: boolean;
		is_on__commit?: string | null;
		apps?: Array<{
			services?: {
				[imageId: string]: {
					releaseId: number;
					status?: string;
					download_progress?: number | null;
				};
			};
		}>;
	};
};

const appAndReleaseOfDeviceQuery = _.once(() =>
	// This is a performance optimization impactful when using device API key permissions,
	// in which case emitting the OR checks for the public device access
	// in a nested subquery didn't perform as well.
	// TODO: Should be converted back to a simple GET to the release resource once
	// the performance of that query improves.
	api.resin.prepare(
		{
			resource: 'application',
			options: {
				$top: 1,
				$select: 'id',
				$expand: {
					owns__release: {
						$top: 1,
						$select: 'id',
						$filter: {
							commit: { '@': 'commit' },
							status: 'success',
						},
					},
				},
				$filter: {
					owns__device: {
						$any: {
							$alias: 'd',
							$expr: {
								d: { id: { '@': 'deviceId' } },
							},
						},
					},
				},
			},
		} as const,
		{ deviceId: ['number'], commit: ['string'] },
	),
);

const resolveReleaseId = async (
	...args: Parameters<ReturnType<typeof appAndReleaseOfDeviceQuery>>
) => {
	const [app] = await appAndReleaseOfDeviceQuery()(...args);
	return app?.owns__release[0]?.id;
};

export const statePatchV2: RequestHandler = async (req, res) => {
	try {
		const { uuid } = req.params;
		if (!uuid) {
			throw new BadRequestError();
		}
		const {
			resolvedDeviceIds: [deviceId],
		} = req.custom as ResolveDeviceInfoCustomObject;
		if (deviceId == null) {
			// We are supposed to have already checked this.
			throw new UnauthorizedError();
		}

		const values = req.body;
		// firstly we need to extract all fields which should be sent to the device
		// resource which is everything but the service entries

		// Every field that is passed to the endpoint is the same, except
		// device name
		const { local } = values as StatePatchV2Body;

		const updateFns: Array<
			(resinApiTx: typeof sbvrUtils.api.resin) => Promise<void>
		> = [];

		if (local != null) {
			const { apps } = local;

			let deviceBody: Pick<LocalBody, (typeof v2ValidPatchFields)[number]> &
				Partial<
					Pick<Device['Write'], 'is_running__release' | 'is_pinned_on__release'>
				> = _.pick(local, v2ValidPatchFields);
			let metricsBody: Pick<LocalBody, (typeof metricsPatchFields)[number]> =
				_.pick(local, metricsPatchFields);
			limitMetricNumbers(metricsBody);
			if (
				Object.keys(metricsBody).length > 0 &&
				(await shouldUpdateMetrics(uuid))
			) {
				// If we should force a metrics update then merge the two together and clear `metricsBody` so
				// that we don't try to merge it again later
				deviceBody = { ...deviceBody, ...metricsBody };
				metricsBody = {};
			}

			if (local.should_be_running__release !== undefined) {
				deviceBody.is_pinned_on__release = local.should_be_running__release;
			}
			if (local.name != null) {
				deviceBody.device_name = local.name;
			}
			if (deviceBody.cpu_id != null) {
				if (/[^\x20-\x7E]/.test(deviceBody.cpu_id)) {
					// if the CPU id is not in the character range of 0x20 (SPACE) to 0x7e (~) we drop the CPU ID
					// this cpu id wouldn't be rendered anyway
					delete deviceBody.cpu_id;
				} else {
					deviceBody.cpu_id = deviceBody.cpu_id.toLowerCase();
				}
			}

			if (
				local.is_on__commit !== undefined ||
				Object.keys(deviceBody).length > 0
			) {
				if (local != null) {
					if (local.is_on__commit === null) {
						deviceBody.is_running__release = null;
					} else if (local.is_on__commit !== undefined) {
						// Run this in a separate read-only transaction in advance, this allows it to be redirected
						// to a read replica as necessary and avoids holding the write transaction open unnecessarily
						const releaseId = await resolveReleaseId(
							{
								commit: local.is_on__commit,
								deviceId,
							},
							undefined,
							{ req },
						);
						if (releaseId != null) {
							// Only set the running release if it's valid, otherwise just silently ignore it
							deviceBody.is_running__release = releaseId;
						}
					}
				}

				updateFns.push(async (resinApiTx) => {
					if (Object.keys(deviceBody).length > 0) {
						// truncate for resilient legacy compatible device state patch so that supervisors don't fail
						// to update b/c of length violation of 255 (SBVR SHORT TEXT type) for ip and mac address.
						// sbvr-types does not export SHORT TEXT VARCHAR length 255 to import.
						deviceBody = truncateShortTextFields(deviceBody);
						await resinApiTx.patch({
							resource: 'device',
							id: deviceId,
							options: {
								$filter: { $not: deviceBody },
							},
							// If we're updating anyway then ensure the metrics data is included
							// but don't use it as a factor as to whether we should actually write or not
							body: { ...deviceBody, ...metricsBody },
						});
					}
				});
			}

			if (apps != null) {
				const imgInstalls = _.flatMap(apps, (app) =>
					_.map(app.services, (svc, imageIdStr) => {
						const imageId = parseInt(imageIdStr, 10);
						if (!Number.isFinite(imageId)) {
							throw new BadRequestError('Invalid image ID value in request');
						}

						const releaseId =
							typeof svc.releaseId === 'number'
								? svc.releaseId
								: parseInt(svc.releaseId, 10);
						if (!Number.isFinite(releaseId)) {
							throw new BadRequestError('Invalid release ID value in request');
						}

						return {
							imageId,
							releaseId,
							status: svc.status,
							downloadProgress: svc.download_progress,
						};
					}),
				);
				const imageIds = imgInstalls.map(({ imageId }) => imageId);

				updateFns.push(async (resinApiTx) => {
					if (imageIds.length > 0) {
						const existingImgInstalls = await resinApiTx.get({
							resource: 'image_install',
							options: {
								$select: ['id', 'installs__image'],
								$filter: {
									device: deviceId,
									installs__image: { $in: imageIds },
								},
							},
						});
						const existingImgInstallsByImage = _.keyBy(
							existingImgInstalls,
							({ installs__image }) => installs__image.__id,
						);

						await Promise.all(
							imgInstalls.map(async (imgInstall) => {
								await upsertImageInstall(
									resinApiTx,
									existingImgInstallsByImage[imgInstall.imageId],
									imgInstall,
									deviceId,
								);
							}),
						);
					}

					await deleteOldImageInstalls(resinApiTx, deviceId, imageIds);
				});
			}
		}

		if (updateFns.length > 0) {
			// Only enter the transaction/do work if there's any updating to be done

			const custom: AnyObject = {}; // shove custom values here to make them available to the hooks
			// forward the public ip address if the request is from the supervisor.
			if (req.apiKey != null) {
				custom.ipAddress = getIP(req);
			}
			await sbvrUtils.db.transaction(async (tx) => {
				const resinApiTx = api.resin.clone({
					passthrough: { req, custom, tx },
				});

				await Promise.all(updateFns.map((updateFn) => updateFn(resinApiTx)));
			});
		}

		res.status(200).end();
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error setting device state');
		res.status(500).end();
	}
};
