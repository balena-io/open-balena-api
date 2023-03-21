import type { RequestHandler } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import { sbvrUtils, errors } from '@balena/pinejs';
import { getIP } from '../../../lib/utils';
import {
	Application,
	Device,
	Image,
	ImageInstall,
	PickDeferred,
	Release,
} from '../../../balena-model';
import type { Filter } from 'pinejs-client-core';
import { metricsPatchFields, v3ValidPatchFields } from '..';
import {
	deleteOldImageInstalls,
	upsertImageInstall,
	shouldUpdateMetrics,
	truncateShortTextFields,
} from '../state-patch-utils';

const { BadRequestError, UnauthorizedError, InternalRequestError } = errors;
const { api } = sbvrUtils;

/**
 * These typings should be used as a guide to what should be sent, but cannot be trusted as what actually *is* sent.
 */
export type StatePatchV3Body = {
	[uuid: string]: {
		status?: string;
		os_version?: string;
		os_variant?: string;
		supervisor_version?: string;
		provisioning_progress?: number | null;
		provisioning_state?: string | null;
		ip_address?: string;
		mac_address?: string;
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
		/**
		 * Used for setting dependent devices as online
		 */
		is_online?: boolean;
		apps?: {
			[uuid: string]: {
				/**
				 * We report the overall release uuid the supervisor considers the active one, even though there may be info for multiple releases.
				 */
				release_uuid?: string;
				releases?: {
					[releaseUUID: string]: {
						services?: {
							[name: string]: {
								image: string;
								status: string;
								download_progress?: number;
							};
						};
					};
				};
			};
		};
	};
};

const fetchData = async (
	req: Express.Request,
	custom: AnyObject,
	uuids: string[],
	appReleaseUuids: {
		[appUuid: string]: {
			releaseUuids: Set<string>;
			imageLocations: string[];
		};
	},
) =>
	await sbvrUtils.db.readTransaction(async (tx) => {
		const resinApiTx = api.resin.clone({
			passthrough: { req, custom, tx },
		});
		const devices = (await resinApiTx.get({
			resource: 'device',
			options: {
				$select: ['id', 'uuid'],
				$filter: {
					uuid: { $in: uuids },
				},
				$expand: {
					belongs_to__application: {
						$select: 'uuid',
					},
				},
			},
		})) as Array<
			Pick<Device, 'id' | 'uuid'> & {
				belongs_to__application: Array<Pick<Application, 'uuid'>>;
			}
		>;
		if (devices.length !== uuids.length) {
			throw new UnauthorizedError();
		}

		const images: Array<Pick<Image, 'id' | 'is_stored_at__image_location'>> =
			[];
		const releasesByAppUuid: {
			[appUuid: string]: Array<Pick<Release, 'id' | 'commit'>>;
		} = {};
		for (const [appUuid, { releaseUuids, imageLocations }] of Object.entries(
			appReleaseUuids,
		)) {
			if (releaseUuids.size === 0) {
				releasesByAppUuid[appUuid] = [];
				continue;
			}

			const imgLocationFilter = imageLocations.map((imgLocation) => {
				const [location, contentHash] = imgLocation.split('@');
				const filter: Filter = { is_stored_at__image_location: location };
				if (contentHash) {
					filter.content_hash = contentHash;
				}
				return filter;
			});

			const appReleases = (releasesByAppUuid[appUuid] = (await resinApiTx.get({
				resource: 'release',
				options: {
					$select: ['id', 'commit'],
					...(imgLocationFilter.length > 0 && {
						$expand: {
							release_image: {
								$select: 'image',
								$expand: {
									image: {
										$select: ['id', 'is_stored_at__image_location'],
									},
								},
								$filter: {
									image: {
										$any: {
											$alias: 'i',
											$expr:
												imgLocationFilter.length === 1
													? { i: imgLocationFilter[0] }
													: {
															$or: imgLocationFilter.map((ilf) => ({
																i: ilf,
															})),
													  },
										},
									},
								},
							},
						},
					}),
					$filter: {
						commit: { $in: Array.from(releaseUuids) },
						status: 'success',
						belongs_to__application: {
							$any: {
								$alias: 'a',
								$expr: {
									a: { uuid: appUuid },
								},
							},
						},
					},
				},
			})) as Array<
				Pick<Release, 'id' | 'commit'> & {
					release_image?: Array<{
						image: Array<Pick<Image, 'id' | 'is_stored_at__image_location'>>;
					}>;
				}
			>);
			if (appReleases.length !== releaseUuids.size) {
				throw new UnauthorizedError();
			}

			if (imageLocations.length > 0) {
				const appImages = appReleases.flatMap(
					(r) => r.release_image?.map((ri) => ri.image[0]) ?? [],
				);
				if (imageLocations.length !== appImages.length) {
					throw new UnauthorizedError();
				}
				images.push(...appImages);
			}
		}
		const devicesByUuid = _.keyBy(devices, (d) => d.uuid);
		return { devicesByUuid, images, releasesByAppUuid };
	});

export const statePatchV3: RequestHandler = async (req, res) => {
	try {
		const body = req.body as StatePatchV3Body;
		const custom: AnyObject = {}; // shove custom values here to make them available to the hooks

		// forward the public ip address if the request is from the supervisor.
		if (req.apiKey != null) {
			custom.ipAddress = getIP(req);
		}

		const uuids = Object.keys(body).filter((uuid) => body[uuid] != null);
		if (uuids.length === 0) {
			throw new BadRequestError();
		}

		const appReleasesCriteria: {
			[appUuid: string]: {
				releaseUuids: Set<string>;
				imageLocations: string[];
			};
		} = {};
		for (const uuid of uuids) {
			const { apps } = body[uuid];
			if (apps != null) {
				for (const [
					appUuid,
					{ release_uuid: isRunningReleaseUuid, releases },
				] of Object.entries(apps)) {
					const appReleaseCriteria = (appReleasesCriteria[appUuid] ??= {
						releaseUuids: new Set<string>(),
						imageLocations: [],
					});
					if (isRunningReleaseUuid) {
						appReleaseCriteria.releaseUuids.add(isRunningReleaseUuid);
					}
					if (releases != null) {
						for (const [releaseUuid, { services }] of Object.entries(
							releases,
						)) {
							appReleaseCriteria.releaseUuids.add(releaseUuid);
							if (services != null) {
								appReleaseCriteria.imageLocations.push(
									...Object.values(services).map((s) => s.image),
								);
							}
						}
					}
				}
			}
		}

		const updateFns: Array<
			(resinApiTx: sbvrUtils.PinejsClient) => Promise<void>
		> = [];

		let data;
		for (const uuid of uuids) {
			const state = body[uuid];

			const { apps } = state;

			let deviceBody:
				| Pick<
						StatePatchV3Body[string],
						(typeof v3ValidPatchFields)[number]
				  > & {
						is_running__release?: number | null;
				  } = _.pick(state, v3ValidPatchFields);
			let metricsBody: Pick<
				StatePatchV3Body[string],
				(typeof metricsPatchFields)[number]
			> = _.pick(state, metricsPatchFields);
			if (
				Object.keys(metricsBody).length > 0 &&
				(await shouldUpdateMetrics(uuid))
			) {
				// If we should force a metrics update then merge the two together and clear `metricsBody` so
				// that we don't try to merge it again later
				deviceBody = { ...deviceBody, ...metricsBody };
				metricsBody = {};
			}

			if (apps != null || Object.keys(deviceBody).length > 0) {
				// We lazily fetch the necessary data only if we absolutely must to avoid unnecessary work if it turns out we don't need it
				data ??= await fetchData(req, custom, uuids, appReleasesCriteria);
				const { images, releasesByAppUuid } = data;
				const device = data.devicesByUuid[uuid];

				if (apps != null) {
					const userAppUuid = device.belongs_to__application[0].uuid;
					if (releasesByAppUuid[userAppUuid] != null) {
						const release = releasesByAppUuid[userAppUuid].find(
							(r) => r.commit === apps[userAppUuid].release_uuid,
						);
						if (release) {
							deviceBody.is_running__release = release.id;
						}
					}
				}

				if (Object.keys(deviceBody).length > 0) {
					// truncate for resilient legacy compatible device state patch so that supervisors don't fail
					// to update b/c of length violation of 255 (SBVR SHORT TEXT type) for ip and mac address.
					// sbvr-types does not export SHORT TEXT VARCHAR length 255 to import.
					deviceBody = truncateShortTextFields(deviceBody);
					// If we're updating anyway then ensure the metrics data is included
					deviceBody = { ...deviceBody, ...metricsBody };
					if (deviceBody.cpu_id != null) {
						deviceBody.cpu_id = deviceBody.cpu_id.toLowerCase();
					}
					updateFns.push(async (resinApiTx) => {
						await resinApiTx.patch({
							resource: 'device',
							id: device.id,
							options: {
								$filter: { $not: deviceBody },
							},
							body: deviceBody,
						});
					});
				}

				if (apps != null) {
					const imgInstalls: Array<{
						imageId: number;
						releaseId: number;
						status: string;
						downloadProgress?: number;
					}> = [];
					for (const [
						appUuid,
						{
							// release_uuid: isRunningReleaseUuid,
							releases = {},
						},
					] of Object.entries(apps)) {
						// // TODO: This gets the release we are running for the given app but currently we handle the user app out of band above, and ignore supervisor/os
						// const release = releases[appUuid].find(
						// 	(r) => r.commit === isRunningReleaseUuid,
						// );
						// if (release == null) {
						// 	throw new InternalRequestError();
						// }
						for (const [releaseUuid, { services = {} }] of Object.entries(
							releases,
						)) {
							const release = releasesByAppUuid[appUuid].find(
								(r) => r.commit === releaseUuid,
							);
							if (release == null) {
								throw new InternalRequestError();
							}
							for (const service of Object.values(services)) {
								const serviceLocation = service.image.split('@', 1)[0];
								const image = images.find(
									(i) => i.is_stored_at__image_location === serviceLocation,
								);
								if (image == null) {
									throw new InternalRequestError();
								}
								imgInstalls.push({
									imageId: image.id,
									releaseId: release.id,
									status: service.status,
									downloadProgress: service.download_progress,
								});
							}
						}
					}

					const imageIds = imgInstalls.map(({ imageId }) => imageId);

					updateFns.push(async (resinApiTx) => {
						// Mark the deleted image installs first so the we don't insert image installs with new ids we don't know about and then immediately mark them deleted
						await deleteOldImageInstalls(resinApiTx, device.id, imageIds);

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
						}
					});
				}
			}
		}

		if (updateFns.length > 0) {
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
		res.sendStatus(500);
	}
};
