import { sbvrUtils, hooks } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';

import { captureException } from '../../../infra/error-handling';

import { postDevices } from '../../device-proxy/device-proxy';

interface CustomObject {
	affectedDevices?: number[];
}

// Env vars hooks
const addEnvHooks = (
	resource: string,
	buildFilter: (
		args: hooks.HookArgs & {
			tx: Tx;
		},
	) => Promise<Filter | undefined>,
): void => {
	const getAffectedDeviceIds = async (
		args: hooks.HookArgs & {
			tx: Tx;
		},
	) => {
		try {
			const filter = await buildFilter(args);
			if (filter == null) {
				return;
			}
			const devices = (await args.api.get({
				resource: 'device',
				options: {
					$select: 'id',
					$filter: filter,
				},
			})) as Array<{ id: number }>;
			return devices.map(({ id }) => id);
		} catch (err) {
			captureException(err, `Error building the ${resource} filter`, {
				req: args.req,
			});
			throw err;
		}
	};

	const envVarHook: hooks.Hooks = {
		POSTRUN: async (args) => {
			const { req, request, tx } = args;
			const devices =
				(request.custom as CustomObject).affectedDevices ??
				(await getAffectedDeviceIds(args));
			if (!devices || devices.length === 0) {
				// If we have no devices affected then no point triggering an update.
				return;
			}
			// Send the update requests only after the tx is committed
			tx.on('end', async () => {
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

const addAppEnvHooks = (resource: string) =>
	addEnvHooks(
		resource,
		async (
			args: hooks.HookArgs & {
				tx: Tx;
			},
		) => {
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

			return {
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								[resource]: {
									$any: {
										$alias: 'e',
										$expr: { e: { id: { $in: envVarIds } } },
									},
								},
							},
						},
					},
				},
			};
		},
	);
addAppEnvHooks('application_config_variable');
addAppEnvHooks('application_environment_variable');

const addDeviceEnvHooks = (resource: string) =>
	addEnvHooks(
		resource,
		async (
			args: hooks.HookArgs & {
				tx: Tx;
			},
		) => {
			if (args.req.body.device != null) {
				// If we have a device passed in the body (ie POST) then we can use that as ID filter.
				return { id: args.req.body.device };
			}

			const envVarIds = await sbvrUtils.getAffectedIds(args);
			if (envVarIds.length === 0) {
				return;
			}
			return {
				[resource]: {
					$any: {
						$alias: 'e',
						$expr: {
							e: { id: { $in: envVarIds } },
						},
					},
				},
			};
		},
	);
addDeviceEnvHooks('device_config_variable');
addDeviceEnvHooks('device_environment_variable');

const addServiceEnvHooks = (resource: string) =>
	addEnvHooks(
		resource,
		async (
			args: hooks.HookArgs & {
				tx: Tx;
			},
		) => {
			if (args.req.body.service != null) {
				return {
					service_install: {
						$any: {
							$alias: 'si',
							$expr: {
								si: {
									service: {
										$any: {
											$alias: 's',
											$expr: { s: { id: args.req.body.service } },
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
			return {
				service_install: {
					$any: {
						$alias: 'si',
						$expr: {
							si: {
								service: {
									$any: {
										$alias: 's',
										$expr: {
											s: {
												[resource]: {
													$any: {
														$alias: 'e',
														$expr: {
															e: { id: { $in: envVarIds } },
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
		},
	);
addServiceEnvHooks('service_environment_variable');
addServiceEnvHooks('service_config_variable');

const addDeviceServiceEnvHooks = (resource: string) =>
	addEnvHooks(
		resource,
		async (
			args: hooks.HookArgs & {
				tx: Tx;
			},
		) => {
			if (args.req.body.service_install != null) {
				return {
					service_install: {
						$any: {
							$alias: 's',
							$expr: { s: { id: args.req.body.service_install } },
						},
					},
				};
			}

			const envVarIds = await sbvrUtils.getAffectedIds(args);
			if (envVarIds.length === 0) {
				return;
			}
			return {
				service_install: {
					$any: {
						$alias: 's',
						$expr: {
							s: {
								[resource]: {
									$any: {
										$alias: 'e',
										$expr: { e: { id: { $in: envVarIds } } },
									},
								},
							},
						},
					},
				},
			};
		},
	);
addDeviceServiceEnvHooks('device_service_environment_variable');
addDeviceServiceEnvHooks('device_service_config_variable');

const addImageEnvHooks = (resource: string) =>
	addEnvHooks(
		resource,
		async (
			args: hooks.HookArgs & {
				tx: Tx;
			},
		) => {
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
													$expr: {
														ri: {
															[resource]: {
																$any: {
																	$alias: 'e',
																	$expr: { e: { id: { $in: envVarIds } } },
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
		},
	);
addImageEnvHooks('image_environment_variable');
addImageEnvHooks('image_config_variable');
