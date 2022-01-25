import type { RequestHandler } from 'express';
import type { Filter } from 'pinejs-client-core';

import * as _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import { getIP } from '../../../lib/utils';
import type {
	GatewayDownload,
	ImageInstall,
	PickDeferred,
} from '../../../balena-model';
import {
	shouldUpdateMetrics,
	shouldUpdateImageInstall,
	metricsPatchFields,
	v2ValidPatchFields,
	ImageInstallUpdateBody,
} from '../state-patch-utils';
import { PinejsClient } from '@balena/pinejs/out/sbvr-api/sbvr-utils';
import type { ResolveDeviceInfoCustomObject } from '../middleware';

const { BadRequestError, UnauthorizedError } = errors;
const { api } = sbvrUtils;

const upsertImageInstall = async (
	resinApi: sbvrUtils.PinejsClient,
	imgInstall: Pick<ImageInstall, 'id'>,
	{
		imageId,
		releaseId,
		status,
		downloadProgress,
	}: {
		imageId: number;
		releaseId: number;
		status: string;
		downloadProgress?: number | null;
	},
	deviceId: number,
): Promise<void> => {
	if (imgInstall == null) {
		// we need to create it with a POST
		await resinApi.post({
			resource: 'image_install',
			body: {
				device: deviceId,
				installs__image: imageId,
				install_date: new Date(),
				status,
				download_progress: downloadProgress,
				is_provided_by__release: releaseId,
			},
			options: { returnResource: false },
		});
	} else {
		// we need to update the current image install
		const body: ImageInstallUpdateBody = {
			status,
			is_provided_by__release: releaseId,
		};
		if (downloadProgress !== undefined) {
			body.download_progress = downloadProgress;
		}
		if (await shouldUpdateImageInstall(imgInstall.id, body)) {
			await resinApi.patch({
				resource: 'image_install',
				id: imgInstall.id,
				body,
				options: {
					$filter: {
						$not: body,
					},
				},
			});
		}
	}
};

const deleteOldImageInstalls = async (
	resinApi: sbvrUtils.PinejsClient,
	deviceId: number,
	imageIds: number[],
): Promise<void> => {
	// Get access to a root api, as images shouldn't be allowed to change
	// the service_install values
	const rootApi = resinApi.clone({
		passthrough: { req: permissions.root },
	});

	const body = { status: 'deleted', download_progress: null };
	const filter: Filter = {
		device: deviceId,
	};
	if (imageIds.length !== 0) {
		filter.$not = [body, { image: { $in: imageIds } }];
	} else {
		filter.$not = body;
	}

	await rootApi.patch({
		resource: 'image_install',
		body,
		options: {
			$filter: filter,
		},
	});
};

const upsertGatewayDownload = async (
	resinApi: sbvrUtils.PinejsClient,
	gatewayDownload: Pick<GatewayDownload, 'id'>,
	deviceId: number,
	{
		imageId,
		status,
		downloadProgress,
	}: {
		imageId: number;
		status: unknown;
		downloadProgress: unknown;
	},
): Promise<void> => {
	if (gatewayDownload == null) {
		await resinApi.post({
			resource: 'gateway_download',
			body: {
				image: imageId,
				is_downloaded_by__device: deviceId,
				status,
				download_progress: downloadProgress,
			},
			options: { returnResource: false },
		});
	} else {
		const body: AnyObject = {
			status,
			download_progress: downloadProgress,
		};
		await resinApi.patch({
			resource: 'gateway_download',
			id: gatewayDownload.id,
			body,
			options: {
				$filter: {
					$not: body,
				},
			},
		});
	}
};

const deleteOldGatewayDownloads = async (
	resinApi: sbvrUtils.PinejsClient,
	deviceId: number,
	imageIds: number[],
): Promise<void> => {
	const body = { status: 'deleted', download_progress: null };
	const filter: Filter = {
		is_downloaded_by__device: deviceId,
	};

	if (imageIds.length !== 0) {
		filter.$not = [body, { image: { $in: imageIds } }];
	} else {
		filter.$not = body;
	}

	await resinApi.patch({
		resource: 'gateway_download',
		body,
		options: {
			$filter: filter,
		},
	});
};

type LocalBody = NonNullable<StatePatchV2Body['local']>;
/**
 * These typings should be used as a guide to what should be sent, but cannot be trusted as what actually *is* sent.
 */
export type StatePatchV2Body = {
	local?: {
		is_managed_by__device?: number;
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
		logs_channel?: string | null;
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
					status: string;
					download_progress?: number | null;
				};
			};
		}>;
	};
	dependent?: {
		apps?: {
			[id: string]: {
				images: {
					[imageId: string]: { status: string; download_progress: number };
				};
			};
		};
	};
};

const releaseOfDeviceQuery = _.once(() =>
	api.resin.prepare<{ uuid: string; commit: string }>({
		resource: 'release',
		options: {
			$select: 'id',
			$filter: {
				commit: { '@': 'commit' },
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								owns__device: {
									$any: {
										$alias: 'd',
										$expr: {
											d: { uuid: { '@': 'uuid' } },
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}),
);

export const statePatchV2: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}
	const { resolvedDevice: device } =
		req.custom as ResolveDeviceInfoCustomObject;
	if (device == null) {
		// We are supposed to have already checked this.
		throw new UnauthorizedError();
	}

	const values = req.body;
	// firstly we need to extract all fields which should be sent to the device
	// resource which is everything but the service entries

	// Every field that is passed to the endpoint is the same, except
	// device name
	const { local, dependent } = values as StatePatchV2Body;

	const updateFns: Array<(resinApiTx: PinejsClient) => Promise<void>> = [];

	if (local != null) {
		const { apps } = local;

		let deviceBody:
			| Pick<LocalBody, typeof v2ValidPatchFields[number]> & {
					is_running__release?: number | null;
			  } = _.pick(local, v2ValidPatchFields);
		let metricsBody: Pick<LocalBody, typeof metricsPatchFields[number]> =
			_.pick(local, metricsPatchFields);
		if (
			Object.keys(metricsBody).length > 0 &&
			(await shouldUpdateMetrics(uuid))
		) {
			// If we should force a metrics update then merge the two together and clear `metricsBody` so
			// that we don't try to merge it again later
			deviceBody = { ...deviceBody, ...metricsBody };
			metricsBody = {};
		}

		if (local.name != null) {
			deviceBody.device_name = local.name;
		}

		if (local.is_on__commit !== undefined || !_.isEmpty(deviceBody)) {
			updateFns.push(async (resinApiTx) => {
				if (local != null) {
					if (local.is_on__commit === null) {
						deviceBody!.is_running__release = null;
					} else if (local.is_on__commit !== undefined) {
						const [release] = await releaseOfDeviceQuery()(
							{ commit: local.is_on__commit, uuid },
							undefined,
							resinApiTx.passthrough,
						);
						if (release != null) {
							// Only set the running release if it's valid, otherwise just silently ignore it
							deviceBody!.is_running__release = release.id;
						}
					}
				}

				if (!_.isEmpty(deviceBody)) {
					// If we're updating anyway then ensure the metrics data is included
					deviceBody = { ...deviceBody, ...metricsBody };
					await resinApiTx.patch({
						resource: 'device',
						id: device.id,
						options: {
							$filter: { $not: deviceBody },
						},
						body: deviceBody,
					});
				}
			});
		}

		if (apps != null) {
			updateFns.push(async (resinApiTx) => {
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

				if (imageIds.length > 0) {
					const existingImgInstalls = (await resinApiTx.get({
						resource: 'image_install',
						options: {
							$select: ['id', 'installs__image'],
							$filter: {
								device: device.id,
								installs__image: { $in: imageIds },
							},
						},
					})) as Array<PickDeferred<ImageInstall, 'id' | 'installs__image'>>;
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
								device.id,
							);
						}),
					);
				}

				await deleteOldImageInstalls(resinApiTx, device.id, imageIds);
			});
		}
	}

	if (dependent?.apps != null) {
		updateFns.push(async (resinApiTx) => {
			// Handle dependent devices if necessary
			const gatewayDownloads = _.flatMap(dependent.apps, ({ images }) =>
				_.map(images, ({ status, download_progress }, imageIdStr) => {
					const imageId = parseInt(imageIdStr, 10);
					if (!Number.isFinite(imageId)) {
						throw new BadRequestError('Invalid image ID value in request');
					}

					return {
						imageId,
						status,
						downloadProgress: download_progress,
					};
				}),
			);
			const imageIds = gatewayDownloads.map(({ imageId }) => imageId);

			if (imageIds.length > 0) {
				const existingGatewayDownloads = (await resinApiTx.get({
					resource: 'gateway_download',
					options: {
						$select: ['id', 'image'],
						$filter: {
							is_downloaded_by__device: device.id,
							image: { $in: imageIds },
						},
					},
				})) as Array<PickDeferred<GatewayDownload, 'id' | 'image'>>;
				const existingGatewayDownloadsByImage = _.keyBy(
					existingGatewayDownloads,
					({ image }) => image.__id,
				);

				await Promise.all(
					gatewayDownloads.map(async (gatewayDownload) => {
						await upsertGatewayDownload(
							resinApiTx,
							existingGatewayDownloadsByImage[gatewayDownload.imageId],
							device.id,
							gatewayDownload,
						);
					}),
				);
			}

			await deleteOldGatewayDownloads(resinApiTx, device.id, imageIds);
		});
	}

	try {
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
		captureException(err, 'Error setting device state', { req });
		res.status(500).end();
	}
};
