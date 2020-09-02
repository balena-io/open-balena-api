import type { RequestHandler } from 'express';
import type { Filter } from 'pinejs-client-core';

import * as _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import { getIP } from '../../../lib/utils';

const { BadRequestError, UnauthorizedError } = errors;
const { api } = sbvrUtils;

const upsertImageInstall = async (
	resinApi: sbvrUtils.PinejsClient,
	imageId: number,
	deviceId: number,
	status: string,
	releaseId: number,
	dlProg?: number,
): Promise<void> => {
	const imgInstall = await resinApi.get({
		resource: 'image_install',
		id: {
			installs__image: imageId,
			device: deviceId,
		},
		options: {
			$select: 'id',
		},
	});

	if (imgInstall == null) {
		// we need to create it with a POST
		await resinApi.post({
			resource: 'image_install',
			body: {
				device: deviceId,
				installs__image: imageId,
				install_date: new Date(),
				status,
				download_progress: dlProg,
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
		if (dlProg !== undefined) {
			body.download_progress = dlProg;
		}
		await resinApi.patch({
			resource: 'image_install',
			id: {
				device: deviceId,
				installs__image: imageId,
			},
			body,
			options: {
				$filter: {
					$not: body,
				},
			},
		});
	}
};

const upsertGatewayDownload = async (
	resinApi: sbvrUtils.PinejsClient,
	deviceId: number,
	imageId: number,
	status: string,
	downloadProgress: number | null,
): Promise<void> => {
	const gatewayDownload = await resinApi.get({
		resource: 'gateway_download',
		id: {
			image: imageId,
			is_downloaded_by__device: deviceId,
		},
		options: {
			$select: 'id',
		},
	});
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
			id: {
				image: imageId,
				is_downloaded_by__device: deviceId,
			},
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
				const imageIds: number[] = [];

				_.each(apps, (app) => {
					_.each(app.services, (svc, imageIdStr) => {
						const imageId = parseInt(imageIdStr, 10);
						imageIds.push(imageId);
						const { status, download_progress } = svc;
						const releaseId = parseInt(svc.releaseId, 10);

						if (!Number.isFinite(imageId)) {
							throw new BadRequestError('Invalid image ID value in request');
						}
						if (!Number.isFinite(releaseId)) {
							throw new BadRequestError('Invalid release ID value in request');
						}

						waitPromises.push(
							upsertImageInstall(
								resinApiTx,
								imageId,
								device.id,
								status,
								releaseId,
								download_progress,
							),
						);
					});
				});

				// Get access to a root api, as images shouldn't be allowed to change
				// the service_install values
				const rootApi = resinApiTx.clone({
					passthrough: { req: permissions.root },
				});

				const body = { status: 'deleted' };
				const filter: Filter = {
					device: device.id,
				};
				if (imageIds.length !== 0) {
					filter.$not = [body, { image: { $in: imageIds } }];
				} else {
					filter.$not = body;
				}

				waitPromises.push(
					rootApi.patch({
						resource: 'image_install',
						body,
						options: {
							$filter: filter,
						},
					}),
				);
			}

			if (dependent != null && dependent.apps != null) {
				// Handle dependent devices if necessary
				const imageIds: number[] = [];
				_.each(dependent.apps, ({ images }) => {
					_.each(images, ({ status, download_progress }, imageIdStr) => {
						const imageId = parseInt(imageIdStr, 10);
						imageIds.push(imageId);
						waitPromises.push(
							upsertGatewayDownload(
								resinApiTx,
								device.id,
								imageId,
								status,
								download_progress,
							),
						);
					});
				});

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
