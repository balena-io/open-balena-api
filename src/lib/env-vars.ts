import * as _ from 'lodash';

export const RESERVED_NAMES = ['RESIN', 'BALENA', 'USER'];

export const RESERVED_NAMESPACES = ['RESIN_', 'BALENA_'];

// Config variables that are allowed to be set by frontend components
export const WHITELISTED_NAMES = [
	'RESIN_APP_RESTART_POLICY',
	'RESIN_APP_RESTART_RETRIES',
	'RESIN_DEPENDENT_DEVICES_HOOK_ADDRESS',
	'RESIN_SUPERVISOR_CONNECTIVITY_CHECK',
	'RESIN_SUPERVISOR_DELTA',
	'RESIN_SUPERVISOR_DELTA_REQUEST_TIMEOUT',
	'RESIN_SUPERVISOR_DELTA_RETRY_COUNT',
	'RESIN_SUPERVISOR_DELTA_RETRY_INTERVAL',
	'RESIN_SUPERVISOR_DELTA_TOTAL_TIMEOUT', // deprecated since Supervisor 6.2.0
	'RESIN_SUPERVISOR_DELTA_VERSION',
	'RESIN_SUPERVISOR_HANDOVER_TIMEOUT',
	'RESIN_SUPERVISOR_LOCAL_MODE',
	'RESIN_SUPERVISOR_LOG_CONTROL',
	'RESIN_SUPERVISOR_POLL_INTERVAL',
	'RESIN_SUPERVISOR_UPDATE_STRATEGY',
	'RESIN_SUPERVISOR_VPN_CONTROL',
	'RESIN_SUPERVISOR_PERSISTENT_LOGGING',
	'BALENA_APP_RESTART_POLICY',
	'BALENA_APP_RESTART_RETRIES',
	'BALENA_DEPENDENT_DEVICES_HOOK_ADDRESS',
	'BALENA_SUPERVISOR_CONNECTIVITY_CHECK',
	'BALENA_SUPERVISOR_DELTA',
	'BALENA_SUPERVISOR_DELTA_REQUEST_TIMEOUT',
	'BALENA_SUPERVISOR_DELTA_RETRY_COUNT',
	'BALENA_SUPERVISOR_DELTA_RETRY_INTERVAL',
	'BALENA_SUPERVISOR_DELTA_TOTAL_TIMEOUT', // deprecated since Supervisor 6.2.0 -- maybe not needed?
	'BALENA_SUPERVISOR_DELTA_VERSION',
	'BALENA_SUPERVISOR_HANDOVER_TIMEOUT',
	'BALENA_SUPERVISOR_LOCAL_MODE',
	'BALENA_SUPERVISOR_LOG_CONTROL',
	'BALENA_SUPERVISOR_POLL_INTERVAL',
	'BALENA_SUPERVISOR_UPDATE_STRATEGY',
	'BALENA_SUPERVISOR_VPN_CONTROL',
	'BALENA_SUPERVISOR_PERSISTENT_LOGGING',
];

// Config variable namespaces that are allowed to be set by frontend components
export const WHITELISTED_NAMESPACES = [
	'RESIN_HOST_',
	'RESIN_UI_',
	'BALENA_HOST_',
	'BALENA_UI_',
];

// These env vars are whitelisted in the API but are set by other means
// (i.e. not directly as env vars from a frontend componenent).
// users must be blocked from setting them and they should be filtered out on display.
export const BLACKLISTED_NAMES = [
	'RESIN_RESTART',
	'RESIN_DEVICE_RESTART',
	'RESIN_OVERRIDE_LOCK',
	'RESIN_SUPERVISOR_OVERRIDE_LOCK',
	'RESIN_SUPERVISOR_NATIVE_LOGGER',
	'RESIN_HOST_LOG_TO_DISPLAY',
	'BALENA_RESTART',
	'BALENA_DEVICE_RESTART',
	'BALENA_OVERRIDE_LOCK',
	'BALENA_SUPERVISOR_OVERRIDE_LOCK',
	'BALENA_SUPERVISOR_NATIVE_LOGGER',
	'BALENA_HOST_LOG_TO_DISPLAY',
];

export const INVALID_CHARACTER_REGEX = /^\d|\W/;
export const INVALID_NEWLINE_REGEX = /\r|\n/;

const startsWithAny = (ns: string[], name: string) => {
	return _.some(ns, n => _.startsWith(name, n));
};

interface EnvVars extends Dictionary<string> {}

const checkVarName = (type: string, name: string) => {
	if (INVALID_CHARACTER_REGEX.test(name)) {
		throw new Error(
			`${type} names can only contain alphanumeric characters and underscores.`,
		);
	}
};

export const checkConfigVarNameValidity = (name: string) => {
	checkVarName('Configuration variable', name);

	if (_.includes(RESERVED_NAMES, name)) {
		throw new Error(
			`Configuration variables ${RESERVED_NAMES.join(', ')} are reserved`,
		);
	}
	if (!startsWithAny(RESERVED_NAMESPACES, name)) {
		throw new Error(
			'Configuration variables must be part of one of the following namespaces: ' +
				RESERVED_NAMESPACES.join(', '),
		);
	}
};

export const checkEnvVarNameValidity = (name: string) => {
	checkVarName('Environment variable', name);

	if (startsWithAny(RESERVED_NAMESPACES, name)) {
		throw new Error(
			`Environment variables beginning with ${RESERVED_NAMESPACES.join(
				', ',
			)} are reserved.`,
		);
	}
	if (_.includes(RESERVED_NAMES, name)) {
		throw new Error(
			`Environment variables ${RESERVED_NAMES.join(', ')} are reserved`,
		);
	}
};

export const checkEnvVarValueValidity = (value: string) => {
	if (INVALID_NEWLINE_REGEX.test(value)) {
		throw new Error('Variable values cannot contain line break characters');
	}
};

export interface EnvVar {
	name: string;
	value: string;
}

export const mergeEnvVars = (
	appConfigVars: EnvVar[],
	appEnvVars: EnvVar[],
	deviceConfigVars: EnvVar[] = [],
	deviceEnvVars: EnvVar[] = [],
) => {
	const environment: EnvVars = {};
	_.each(appConfigVars, appConfigVar => {
		environment[appConfigVar.name] = appConfigVar.value;
	});
	_.each(appEnvVars, appEnvVar => {
		environment[appEnvVar.name] = appEnvVar.value;
	});
	_.each(deviceConfigVars, deviceConfigVar => {
		environment[deviceConfigVar.name] = deviceConfigVar.value;
	});
	_.each(deviceEnvVars, deviceEnvVar => {
		environment[deviceEnvVar.name] = deviceEnvVar.value;
	});
	return environment;
};

export const DEFAULT_SUPERVISOR_POLL_INTERVAL = 10 * 60 * 1000;
