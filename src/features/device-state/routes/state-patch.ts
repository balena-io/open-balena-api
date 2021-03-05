import type { RequestHandler } from 'express';
import type { Filter } from 'pinejs-client-core';

import * as _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import { getIP } from '../../../lib/utils';
import {
	GatewayDownload,
	ImageInstall,
	PickDeferred,
} from '../../../balena-model';

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
		status: unknown;
		downloadProgress: unknown;
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
		const body: AnyObject = {
			status,
			is_provided_by__release: releaseId,
		};
		if (downloadProgress !== undefined) {
			body.download_progress = downloadProgress;
		}
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

	const body = { status: 'deleted' };
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
		await resinApi.patch({
			resource: 'gateway_download',
			id: gatewayDownload.id,
			body: {
				status,
				download_progress: downloadProgress,
			},
		});
	}
};

const deleteOldGatewayDownloads = async (
	resinApi: sbvrUtils.PinejsClient,
	deviceId: number,
	imageIds: number[],
): Promise<void> => {
	const filter: Filter = {
		is_downloaded_by__device: deviceId,
	};

	if (imageIds.length !== 0) {
		filter.$not = { image: { $in: imageIds } };
	}

	await resinApi.patch({
		resource: 'gateway_download',
		options: {
			$filter: filter,
		},
		body: { status: 'deleted' },
	});
};

const validPatchFields = [
	'is_managed_by__device',
	'should_be_running__release',
	'device_name',
	'status',
	'is_online',
	'note',
	'os_version',
	'os_variant',
	'supervisor_version',
	'provisioning_progress',
	'provisioning_state',
	'ip_address',
	'mac_address',
	'download_progress',
	'api_port',
	'api_secret',
	'logs_channel',
	'memory_usage',
	'memory_total',
	'storage_block_device',
	'storage_usage',
	'storage_total',
	'cpu_temp',
	'cpu_usage',
	'cpu_id',
	'is_undervolted',
];

export const statePatch: RequestHandler = async (req, res) => {
	const { uuid } = req.params;
	if (!uuid) {
		return res.status(400).end();
	}

	const custom: AnyObject = {}; // shove custom values here to make them available to the hooks

	const values = req.body;
	// firstly we need to extract all fields which should be sent to the device
	// resource which is everything but the service entries

	// Every field that is passed to the endpoint is the same, except
	// device name
	const { local, dependent } = values;

	let apps: undefined | AnyObject[];
	let deviceBody: undefined | AnyObject;
	if (local != null) {
		apps = local.apps;

		deviceBody = _.pick(local, validPatchFields);

		if (local.name != null) {
			deviceBody.device_name = local.name;
		}
	}

	// forward the public ip address if the request is from the supervisor.
	if (req.apiKey != null) {
		custom.ipAddress = getIP(req);
	}

	try {
		await sbvrUtils.db.transaction(async (tx) => {
			const resinApiTx = api.resin.clone({ passthrough: { req, custom, tx } });

			const device = await resinApiTx.get({
				resource: 'device',
				id: { uuid },
				options: {
					$select: 'id',
				},
			});

			if (device == null) {
				throw new UnauthorizedError();
			}

			if (local != null) {
				if (local.is_on__commit === null) {
					deviceBody!.is_running__release = null;
				} else if (local.is_on__commit !== undefined) {
					const [release] = await resinApiTx.get({
						resource: 'release',
						options: {
							$select: 'id',
							$filter: {
								commit: local.is_on__commit,
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
															d: { uuid },
														},
													},
												},
											},
										},
									},
								},
							},
						},
					});

					if (release != null) {
						// Only set the running release if it's valid, otherwise just silently ignore it
						deviceBody!.is_running__release = release.id;
					}
				}
			}

			const waitPromises: Array<PromiseLike<any>> = [];

			if (!_.isEmpty(deviceBody)) {
				waitPromises.push(
					resinApiTx.patch({
						resource: 'device',
						id: device.id,
						options: {
							$filter: { $not: deviceBody },
						},
						body: deviceBody,
					}),
				);
			}

			if (apps != null) {
				const imgInstalls = _.flatMap(apps, (app) =>
					_.map(app.services, (svc, imageIdStr) => {
						const imageId = parseInt(imageIdStr, 10);
						if (!Number.isFinite(imageId)) {
							throw new BadRequestError('Invalid image ID value in request');
						}

						const releaseId = parseInt(svc.releaseId, 10);
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
					waitPromises.push(
						(async () => {
							const existingImgInstalls = (await resinApiTx.get({
								resource: 'image_install',
								options: {
									$select: ['id', 'installs__image'],
									$filter: {
										device: device.id,
										installs__image: { $in: imageIds },
									},
								},
							})) as Array<
								PickDeferred<ImageInstall, 'id' | 'installs__image'>
							>;
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
						})(),
					);
				}

				waitPromises.push(
					deleteOldImageInstalls(resinApiTx, device.id, imageIds),
				);
			}

			if (dependent != null && dependent.apps != null) {
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
					waitPromises.push(
						(async () => {
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
						})(),
					);
				}

				waitPromises.push(
					deleteOldGatewayDownloads(resinApiTx, device.id, imageIds),
				);
			}

			await Promise.all(waitPromises);
		});

		res.sendStatus(200);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error setting device state', { req });
		res.sendStatus(500);
	}
};
