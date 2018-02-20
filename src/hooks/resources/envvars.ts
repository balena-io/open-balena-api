import * as _ from 'lodash';
import { sbvrUtils, Tx, getCurrentRequestAffectedIds } from '../../platform';
import {
	checkEnvVarNameValidity,
	checkConfigVarNameValidity,
	checkEnvVarValueValidity,
} from '../../lib/env-vars';
import { postDevices } from '../../lib/device-proxy';
import { PinejsClientCoreFactory } from 'pinejs-client-core';
import * as Promise from 'bluebird';
import { captureException } from '../../platform/errors';

interface ValidateFn {
	(args: { varName?: string; varValue?: string }): void;
}

const triggerDevices = (
	filter: PinejsClientCoreFactory.Filter | undefined,
	req: sbvrUtils.HookReq,
) => {
	// If we can't find the matching env var to update then we don't ping the devices.
	// - This should only happen in the case of deleting an application, where we delete all of the env vars at once.
	if (filter == null) {
		return;
	}

	return postDevices({
		url: '/v1/update',
		req,
		filter,
		// Don't wait for the posts to complete,
		// as they may take a long time and we've already sent the prompt to update.
		wait: false,
	});
};

// Env vars hooks
const addEnvHooks = (
	resource: string,
	nameProp: string,
	validateFn: Function,
	buildFilter: (
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => Promise<PinejsClientCoreFactory.Filter | undefined>,
) => {
	let postParseHook: sbvrUtils.Hooks['POSTPARSE'];
	if (_.isFunction(validateFn)) {
		postParseHook = ({ request }) => {
			const varName = request.values[nameProp];
			const varValue = request.values['value'];
			return validateFn({ varName, varValue });
		};
	}
	const preRunHook: sbvrUtils.Hooks['PRERUN'] = args =>
		buildFilter(args)
			.then(filter => {
				if (filter == null) {
					return;
				}
				return args.api
					.get({
						resource: 'device',
						options: {
							$select: 'id',
							$filter: filter,
						},
					})
					.then((devices: AnyObject[]) => {
						args.request.custom.devices = _.map(devices, 'id');
					});
			})
			.tapCatch(err => {
				captureException(err, `Error building the ${resource} filter`, {
					req: args.req,
				});
			});

	const envVarHook: sbvrUtils.Hooks = {
		POSTPARSE: postParseHook,
		PRERUN: preRunHook,
		POSTRUN: ({ req, request }) => {
			const { devices } = request.custom;
			if (!devices || devices.length === 0) {
				// If we have no devices affected then no point triggering an update.
				return;
			}
			const filter = { id: { $in: devices } };
			return triggerDevices(filter, req);
		},
	};

	sbvrUtils.addPureHook('POST', 'resin', resource, envVarHook);
	sbvrUtils.addPureHook('PATCH', 'resin', resource, envVarHook);
	sbvrUtils.addPureHook('PUT', 'resin', resource, envVarHook);
	sbvrUtils.addPureHook('DELETE', 'resin', resource, envVarHook);
};

const checkConfigVarValidity: ValidateFn = ({ varName, varValue }) => {
	if (varName != null) {
		checkConfigVarNameValidity(varName);
	}
	if (varValue != null) {
		checkEnvVarValueValidity(varValue);
	}
};

const checkEnvVarValidity: ValidateFn = ({ varName, varValue }) => {
	if (varName != null) {
		checkEnvVarNameValidity(varName);
	}
	if (varValue != null) {
		checkEnvVarValueValidity(varValue);
	}
};

addEnvHooks(
	'application_config_variable',
	'name',
	checkConfigVarValidity,
	(
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => {
		if (args.req.body.application != null) {
			// If we have an application passed in the body (ie POST) then we can use that to find the devices to update.
			return Promise.resolve({
				belongs_to__application: args.req.body.application,
			});
		}

		return getCurrentRequestAffectedIds(args).then(envVarIds => {
			if (envVarIds.length === 0) {
				return;
			}
			return {
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								application_config_variable: {
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
			};
		});
	},
);

addEnvHooks(
	'application_environment_variable',
	'env_var_name',
	checkEnvVarValidity,
	(
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => {
		if (args.req.body.application != null) {
			// If we have an application passed in the body (ie POST) then we can use that to find the devices to update.
			return Promise.resolve({
				belongs_to__application: args.req.body.application,
			});
		}
		return getCurrentRequestAffectedIds(args).then(envVarIds => {
			if (envVarIds.length === 0) {
				return;
			}

			return {
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								application_environment_variable: {
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
		});
	},
);

addEnvHooks(
	'device_config_variable',
	'name',
	checkConfigVarValidity,
	(
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => {
		if (args.req.body.device != null) {
			// If we have a device passed in the body (ie POST) then we can use that as ID filter.
			return Promise.resolve({ id: args.req.body.device });
		}

		return getCurrentRequestAffectedIds(args).then(envVarIds => {
			if (envVarIds.length === 0) {
				return;
			}
			return {
				device_config_variable: {
					$any: {
						$alias: 'e',
						$expr: {
							e: { id: { $in: envVarIds } },
						},
					},
				},
			};
		});
	},
);

addEnvHooks(
	'device_environment_variable',
	'env_var_name',
	checkEnvVarValidity,
	(
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => {
		if (args.req.body.device != null) {
			// If we have a device passed in the body (ie POST) then we can use that as ID filter.
			return Promise.resolve({ id: args.req.body.device });
		}

		return getCurrentRequestAffectedIds(args).then(envVarIds => {
			if (envVarIds.length === 0) {
				return;
			}
			return {
				device_environment_variable: {
					$any: {
						$alias: 'e',
						$expr: {
							e: { id: { $in: envVarIds } },
						},
					},
				},
			};
		});
	},
);

addEnvHooks(
	'service_environment_variable',
	'name',
	checkEnvVarValidity,
	(
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => {
		if (args.req.body.service != null) {
			return Promise.resolve({
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
			});
		}

		return getCurrentRequestAffectedIds(args).then(envVarIds => {
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
		});
	},
);

addEnvHooks(
	'device_service_environment_variable',
	'name',
	checkEnvVarValidity,
	(
		args: sbvrUtils.HookArgs & {
			tx: Tx;
		},
	) => {
		if (args.req.body.service_install != null) {
			return Promise.resolve({
				service_install: {
					$any: {
						$alias: 's',
						$expr: { s: { id: args.req.body.service_install } },
					},
				},
			});
		}

		return getCurrentRequestAffectedIds(args).then(envVarIds => {
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
		});
	},
);
