import type BalenaModel from '../../../balena-model.js';
import { sbvrUtils, hooks } from '@balena/pinejs';
import _ from 'lodash';
import type { FilterObj } from 'pinejs-client-core';

import { captureException } from '../../../infra/error-handling/index.js';

import { postDevices } from '../../device-proxy/device-proxy.js';
import type { Device } from '../../../balena-model.js';
import { setTimeout } from 'timers/promises';

interface CustomObject {
	affectedDevices?: number[];
}

// Postgresql uses 16 bits to address the binds of sql commands. We use a number a bit below
// that limit to chunk the binds, in order to have some extra room for other things like
// computed terms/permissions.
// See: https://www.postgresql.org/docs/13/protocol-message-formats.html#:~:text=The%20number%20of%20parameter%20values%20that%20follow
const MAX_SAFE_SQL_BINDS = 2 ** 16 - 1 - 100;

// Env vars hooks
const addEnvHooks = <T extends keyof BalenaModel>(
	resource: T,
	buildFilter: (
		args: hooks.HookArgs<'resin'> & {
			tx: Tx;
		},
	) => Promise<
		| FilterObj<Device['Read']>
		| [
				affectedIds: number[],
				filterBuilder: (ids: number[]) => FilterObj<Device['Read']>,
		  ]
		| undefined
	>,
): void => {
	const getAffectedDeviceIds = async (
		args: hooks.HookArgs<'resin'> & {
			tx: Tx;
		},
	) => {
		try {
			const filter = await buildFilter(args);
			if (filter == null) {
				return;
			}
			const filters = Array.isArray(filter)
				? (() => {
						const [affectedIds, filterBuilder] = filter;
						// Chunk the affected device retrieval, since a using $in errors with `code: '42P01'` for more than 66k IDs.
						return _.chunk(affectedIds, MAX_SAFE_SQL_BINDS).map((ids) =>
							filterBuilder(ids),
						);
					})()
				: [filter];
			const deviceIds = (
				await Promise.all(
					filters.map(async ($filter) =>
						(
							await args.api.get({
								resource: 'device',
								options: {
									$select: 'id',
									$filter,
								},
							})
						).map(({ id }) => id),
					),
				)
			).flat();
			return deviceIds;
		} catch (err) {
			captureException(err, `Error building the ${resource} filter`);
			throw err;
		}
	};

	const envVarHook: hooks.Hooks<'resin'> = {
		POSTRUN: (args) => {
			const { req, request } = args;
			// Send the update requests in a separate read tx so that the writer has less work to do.
			args.tx.on('end', async () => {
				let devices = (request.custom as CustomObject).affectedDevices;
				if (devices == null) {
					// Since we use a new read transaction, we also add an artificial delay
					// to make sure that the committed data have propagated to the readers.
					// W/o this there would be a chance for POSTs to never trigger device updates
					// in case the replication lag is high enough.
					await setTimeout(1000);
					devices = await sbvrUtils.db.readTransaction(async (tx) => {
						return await getAffectedDeviceIds({
							...args,
							api: sbvrUtils.api.resin.clone({
								passthrough: { req, tx },
							}),
							tx,
						});
					});
				}
				if (!devices || devices.length === 0) {
					// If we have no devices affected then no point triggering an update.
					return;
				}
				try {
					await postDevices({
						url: '/v1/update',
						req,
						filter: { id: { $in: devices } },
						wait: false,
					});
				} catch (err) {
					captureException(err, 'Error notifying device updates');
				}
			});
		},
	};

	hooks.addPureHook('POST', 'resin', resource, envVarHook);
	hooks.addPureHook('PATCH', 'resin', resource, envVarHook);
	hooks.addPureHook('PUT', 'resin', resource, envVarHook);
	hooks.addPureHook('DELETE', 'resin', resource, {
		PRERUN: async (args) => {
			(args.request.custom as CustomObject).affectedDevices =
				await getAffectedDeviceIds(args);
		},
		...envVarHook,
	});
};

const addAppEnvHooks = (resource: keyof BalenaModel) => {
	addEnvHooks(resource, async (args) => {
		if (args.req.body.application != null) {
			// If we have an application passed in the body (ie POST) then we can use that to find the devices to update.
			return {
				belongs_to__application: args.req.body.application,
			};
		}
		const envVarIds = await sbvrUtils.getAffectedIds(args);
		if (envVarIds.length === 0) {
			return;
		}

		return [
			envVarIds,
			(envVarIdsChunk) => ({
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								[resource]: {
									$any: {
										$alias: 'e',
										$expr: { e: { id: { $in: envVarIdsChunk } } },
									},
								},
							},
						},
					},
				},
			}),
		];
	});
};

addAppEnvHooks('application_config_variable');
addAppEnvHooks('application_environment_variable');

const addDeviceEnvHooks = (resource: keyof BalenaModel) => {
	addEnvHooks(resource, async (args) => {
		if (args.req.body.device != null) {
			// If we have a device passed in the body (ie POST) then we can use that as ID filter.
			return { id: args.req.body.device };
		}

		const envVarIds = await sbvrUtils.getAffectedIds(args);
		if (envVarIds.length === 0) {
			return;
		}
		return [
			envVarIds,
			(envVarIdsChunk) => ({
				[resource]: {
					$any: {
						$alias: 'e',
						$expr: {
							e: { id: { $in: envVarIdsChunk } },
						},
					},
				},
			}),
		];
	});
};

addDeviceEnvHooks('device_config_variable');
addDeviceEnvHooks('device_environment_variable');
addDeviceEnvHooks('device_service_environment_variable');

addEnvHooks('service_environment_variable', async (args) => {
	if (args.req.body.service != null) {
		return {
			should_be_running__release: {
				$any: {
					$alias: 'r',
					$expr: {
						r: {
							contains__image: {
								$any: {
									$alias: 'ci',
									$expr: {
										ci: {
											image: {
												$any: {
													$alias: 'i',
													$expr: {
														i: {
															is_a_build_of__service: {
																$any: {
																	$alias: 's',
																	$expr: { s: { id: args.req.body.service } },
																},
															},
														},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		};
	}

	const envVarIds = await sbvrUtils.getAffectedIds(args);
	if (envVarIds.length === 0) {
		return;
	}
	return [
		envVarIds,
		(envVarIdsChunk) => ({
			should_be_running__release: {
				$any: {
					$alias: 'r',
					$expr: {
						r: {
							contains__image: {
								$any: {
									$alias: 'ci',
									$expr: {
										ci: {
											image: {
												$any: {
													$alias: 'i',
													$expr: {
														i: {
															is_a_build_of__service: {
																$any: {
																	$alias: 's',
																	$expr: {
																		s: {
																			service_environment_variable: {
																				$any: {
																					$alias: 'e',
																					$expr: {
																						e: { id: { $in: envVarIdsChunk } },
																					},
																				},
																			},
																		},
																	},
																},
															},
														},
													},
												},
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
	];
});

addEnvHooks('image_environment_variable', async (args) => {
	if (args.req.body.release_image != null) {
		return {
			image_install: {
				$any: {
					$alias: 'ii',
					$expr: {
						installs__image: {
							$any: {
								$alias: 'i',
								$expr: {
									i: {
										release_image: {
											$any: {
												$alias: 'ri',
												$expr: { ri: { id: args.req.body.release_image } },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		};
	}

	const envVarIds = await sbvrUtils.getAffectedIds(args);
	if (envVarIds.length === 0) {
		return;
	}
	return [
		envVarIds,
		(envVarIdsChunk) => ({
			image_install: {
				$any: {
					$alias: 'ii',
					$expr: {
						installs__image: {
							$any: {
								$alias: 'i',
								$expr: {
									i: {
										release_image: {
											$any: {
												$alias: 'ri',
												$expr: {
													ri: {
														image_environment_variable: {
															$any: {
																$alias: 'e',
																$expr: { e: { id: { $in: envVarIdsChunk } } },
															},
														},
													},
												},
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
	];
});
