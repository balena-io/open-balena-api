import { sbvrUtils, hooks } from '@balena/pinejs';
import type { Filter } from 'pinejs-client-core';

import { captureException } from '../../../infra/error-handling';

import { postDevices } from '../../device-proxy/device-proxy';

// Env vars hooks
const addEnvHooks = (
	resource: string,
	buildFilter: (
		args: hooks.HookArgs & {
			tx: Tx;
		},
	) => Promise<Filter | undefined>,
): void => {
	const envVarHook: hooks.Hooks = {
		PRERUN: async (args) => {
			try {
				const filter = await buildFilter(args);
				if (filter == null) {
					return;
				}
				const devices = await args.api.get({
					resource: 'device',
					options: {
						$select: 'id',
						$filter: filter,
					},
				});
				args.request.custom.devices = devices.map(({ id }) => id);
			} catch (err) {
				captureException(err, `Error building the ${resource} filter`, {
					req: args.req,
				});
				throw err;
			}
		},
		POSTRUN: async ({ req, request }) => {
			const { devices } = request.custom;
			if (!devices || devices.length === 0) {
				// If we have no devices affected then no point triggering an update.
				return;
			}
			const filter = { id: { $in: devices } };

			// If we can't find the matching env var to update then we don't ping the devices.
			// - This should only happen in the case of deleting an application, where we delete all of the env vars at once.
			if (filter == null) {
				return;
			}

			await postDevices({
				url: '/v1/update',
				req,
				filter,
				// Don't wait for the posts to complete,
				// as they may take a long time and we've already sent the prompt to update.
				wait: false,
			});
		},
	};

	hooks.addPureHook('POST', 'resin', resource, envVarHook);
	hooks.addPureHook('PATCH', 'resin', resource, envVarHook);
	hooks.addPureHook('PUT', 'resin', resource, envVarHook);
	hooks.addPureHook('DELETE', 'resin', resource, envVarHook);
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
					device_application: {
						$any: {
							$alias: 'da',
							$expr: {
								da: {
									belongs_to__application: args.req.body.application,
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
				device_application: {
					$any: {
						$alias: 'da',
						$expr: {
							da: {
								belongs_to__application: {
									$any: {
										$alias: 'a',
										$expr: {
											a: {
												[resource]: {
													$any: {
														$alias: 'e',
														$expr: {
															e: {
																id: { $in: envVarIds },
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
addDeviceEnvHooks('device_application_environment_variable');

addEnvHooks(
	'service_environment_variable',
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
											service_environment_variable: {
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

addEnvHooks(
	'device_service_environment_variable',
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
							device_service_environment_variable: {
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
