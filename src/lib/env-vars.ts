import * as _ from 'lodash';
import { JSONSchema6Definition } from 'json-schema';
import * as semver from 'resin-semver';

export const RESERVED_NAMES = ['RESIN', 'BALENA', 'USER'];

export const RESERVED_NAMESPACES = ['RESIN_', 'BALENA_'];

// Config variables that are allowed to be set externally
// Note that this list will be mutated by the cloud API to add
// extra variables as for cloud-only features.
export const CONFIG_VAR_NAMES = [
	'APP_RESTART_POLICY',
	'APP_RESTART_RETRIES',
	'DEPENDENT_DEVICES_HOOK_ADDRESS',
	'SUPERVISOR_CONNECTIVITY_CHECK',
	'SUPERVISOR_HANDOVER_TIMEOUT',
	'SUPERVISOR_LOCAL_MODE',
	'SUPERVISOR_LOG_CONTROL',
	'SUPERVISOR_POLL_INTERVAL',
	'SUPERVISOR_UPDATE_STRATEGY',
	'SUPERVISOR_VPN_CONTROL',
	'SUPERVISOR_PERSISTENT_LOGGING',
];

// Config variable namespaces that are allowed to be set by frontend components
export const CONFIG_VAR_NAMESPACES = ['HOST_', 'UI_'];

// These env vars are whitelisted in the API but are set by other means
// (i.e. not directly as env vars from a frontend componenent).
// users must be blocked from setting them and they should be filtered out on display.
export const BLACKLISTED_NAMES = [
	'RESTART',
	'DEVICE_RESTART',
	'OVERRIDE_LOCK',
	'SUPERVISOR_OVERRIDE_LOCK',
	'SUPERVISOR_NATIVE_LOGGER',
	'HOST_LOG_TO_DISPLAY',
];

export const INVALID_CHARACTER_REGEX = /^\d|\W/;
export const INVALID_NEWLINE_REGEX = /\r|\n/;

export const DEFAULT_SUPERVISOR_POLL_INTERVAL = 10 * 60 * 1000;

// Note that this list will be mutated by the cloud API to add
// extra variables as for cloud-only features.
export const SUPERVISOR_CONFIG_VAR_PROPERTIES: {
	[k: string]: JSONSchema6Definition;
} = {
	SUPERVISOR_CONNECTIVITY_CHECK: {
		enum: ['false', 'true'],
		description: 'Enable / Disable VPN connectivity check',
		default: 'true',
	},
	SUPERVISOR_LOG_CONTROL: {
		enum: ['false', 'true'],
		description: 'Enable / Disable logs from being sent to balena',
		default: 'true',
	},
	SUPERVISOR_POLL_INTERVAL: {
		type: 'integer',
		description: 'Define the balena API poll interval in milliseconds',
		default: DEFAULT_SUPERVISOR_POLL_INTERVAL,
		minimum: DEFAULT_SUPERVISOR_POLL_INTERVAL,
		maximum: 86400000,
	},
	SUPERVISOR_VPN_CONTROL: {
		enum: ['false', 'true'],
		description: 'Enable / Disable VPN',
		default: 'true',
	},
	SUPERVISOR_PERSISTENT_LOGGING: {
		enum: ['false', 'true'],
		description:
			'Enable persistent logging. Only supported by supervisor versions >= v7.15.0.',
		default: 'false',
	},
};

export const HOST_CONFIG_VAR_PROPERTIES: {
	[k: string]: JSONSchema6Definition;
} = {
	HOST_CONFIG_disable_splash: {
		enum: ['0', '1'],
		description: 'Enable / Disable the balena splash screen',
		default: '1',
	},
	HOST_CONFIG_dtparam: {
		type: 'string',
		description: 'Define DT parameters',
		default: '"i2c_arm=on","spi=on","audio=on"',
	},
	HOST_CONFIG_enable_uart: {
		enum: ['0', '1'],
		description: 'Enable / Disable UART',
		default: '1',
	},
	HOST_CONFIG_gpu_mem: {
		type: 'integer',
		description: 'Define device GPU memory in megabytes.',
		default: 16,
	},
};

// the namespace HOST_CONFIG_ is only applicable for raspberrypis
// as it supports the config.txt file
export const HOST_CONFIG_CAPABLE_DEVICE_TYPES = [
	'raspberry-pi',
	'raspberry-pi2',
	'raspberrypi3-64',
	'raspberrypi3',
	'fincm3',
];

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

export type EnvVarList = Array<
	{ env_var_name: string; value: string } | { name: string; value: string }
>;

export const varListInsert = (varList: EnvVarList, obj: Dictionary<string>) => {
	_.each(varList, evar => {
		if ('env_var_name' in evar) {
			obj[evar.env_var_name] = evar.value;
		} else {
			obj[evar.name] = evar.value;
		}
	});
};

// Some config vars cause issues with certain versions of resinOS.
// This function will check the OS version against the config
// vars and filter any which cause problems, returning a new map to
// be sent to the device.
//
// `configVars` should be in the form { [name: string]: string }
export const filterDeviceConfig = (
	configVars: EnvVars,
	osVersion: string,
): EnvVars => {
	// ResinOS >= 2.x has a read-only file system, and this var causes the
	// supervisor to run `systemctl enable|disable [unit]`, which does not
	// persist over reboots. This causes the supervisor to go into a reboot
	// loop, so filter out this var for these os versions.
	if (semver.gte(osVersion, '2.0.0')) {
		return _.omit(configVars, 'HOST_LOG_TO_DISPLAY');
	}
	return configVars;
};

const applyPrefix = (name: string, prefix: string = 'RESIN_') =>
	`${prefix}${name}`;

// Returns a new object with all keys prefixed with `RESIN_`.
// This should only be used in places that deal with legacy
// clients (eg. Supervisors that expect config vars to be
// prefixed).
export const fixupConfigVars = (configVars: EnvVars): EnvVars =>
	_.mapKeys(configVars, applyPrefix);

export interface EnvVar {
	name: string;
	value: string;
}

// FIXME: move out of here -- this is only used by the /environment route
// handler in cloud API and is about dealing with pre-multicontainer devices.
export const mergeEnvVars = (
	appConfigVars: EnvVar[],
	appEnvVars: EnvVar[],
	deviceConfigVars: EnvVar[] = [],
	deviceEnvVars: EnvVar[] = [],
) => {
	const environment: EnvVars = {};
	_.each(appConfigVars, appConfigVar => {
		environment[applyPrefix(appConfigVar.name)] = appConfigVar.value;
	});
	_.each(appEnvVars, appEnvVar => {
		environment[appEnvVar.name] = appEnvVar.value;
	});
	_.each(deviceConfigVars, deviceConfigVar => {
		environment[applyPrefix(deviceConfigVar.name)] = deviceConfigVar.value;
	});
	_.each(deviceEnvVars, deviceEnvVar => {
		environment[deviceEnvVar.name] = deviceEnvVar.value;
	});
	return environment;
};
