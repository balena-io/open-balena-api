import type { JSONSchema6Definition } from 'json-schema';

import { errors } from '@balena/pinejs';

import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from './config';

const { BadRequestError } = errors;

export const RESERVED_NAMES = ['RESIN', 'BALENA', 'USER'];

export const RESERVED_NAMESPACES = ['RESIN_', 'BALENA_'];

// Config variables that are allowed to be set externally
// Note that this list will be mutated by the cloud API to add
// extra variables as for cloud-only features.
export const ALLOWED_NAMES = [
	'RESIN_APP_RESTART_POLICY',
	'RESIN_APP_RESTART_RETRIES',
	'RESIN_DEPENDENT_DEVICES_HOOK_ADDRESS',
	'RESIN_SUPERVISOR_CONNECTIVITY_CHECK',
	'RESIN_SUPERVISOR_HANDOVER_TIMEOUT',
	'RESIN_SUPERVISOR_LOCAL_MODE',
	'RESIN_SUPERVISOR_LOG_CONTROL',
	'RESIN_SUPERVISOR_POLL_INTERVAL',
	'RESIN_SUPERVISOR_UPDATE_STRATEGY',
	'RESIN_SUPERVISOR_VPN_CONTROL',
	'RESIN_SUPERVISOR_PERSISTENT_LOGGING',
	'RESIN_SUPERVISOR_INSTANT_UPDATE_TRIGGER',
	'BALENA_APP_RESTART_POLICY',
	'BALENA_APP_RESTART_RETRIES',
	'BALENA_DEPENDENT_DEVICES_HOOK_ADDRESS',
	'BALENA_SUPERVISOR_CONNECTIVITY_CHECK',
	'BALENA_SUPERVISOR_HANDOVER_TIMEOUT',
	'BALENA_SUPERVISOR_LOCAL_MODE',
	'BALENA_SUPERVISOR_LOG_CONTROL',
	'BALENA_SUPERVISOR_POLL_INTERVAL',
	'BALENA_SUPERVISOR_UPDATE_STRATEGY',
	'BALENA_SUPERVISOR_VPN_CONTROL',
	'BALENA_SUPERVISOR_PERSISTENT_LOGGING',
	'BALENA_SUPERVISOR_INSTANT_UPDATE_TRIGGER',
];

// Config variable namespaces that are allowed to be set by frontend components
export const ALLOWED_NAMESPACES = [
	'RESIN_HOST_',
	'RESIN_UI_',
	'BALENA_HOST_',
	'BALENA_UI_',
];

// These env vars are allowed in the API but are set by other means
// (i.e. not directly as env vars from a frontend componenent).
// users must be blocked from setting them and they should be filtered out on display.
export const BLOCKED_NAMES = [
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

// Note that this list will be mutated by the cloud API to add
// extra variables as for cloud-only features.
export const SUPERVISOR_CONFIG_VAR_PROPERTIES: {
	[k: string]: JSONSchema6Definition;
} = {
	RESIN_SUPERVISOR_CONNECTIVITY_CHECK: {
		enum: ['false', 'true'],
		description: 'Enable / Disable VPN connectivity check',
		default: 'true',
	},
	RESIN_SUPERVISOR_LOG_CONTROL: {
		enum: ['false', 'true'],
		description: 'Enable / Disable logs from being sent to balena',
		default: 'true',
	},
	RESIN_SUPERVISOR_POLL_INTERVAL: {
		type: 'integer',
		description: 'Define the balena API poll interval in milliseconds',
		default: DEFAULT_SUPERVISOR_POLL_INTERVAL,
		minimum: DEFAULT_SUPERVISOR_POLL_INTERVAL,
		maximum: 86400000,
	},
	RESIN_SUPERVISOR_VPN_CONTROL: {
		enum: ['false', 'true'],
		description: 'Enable / Disable VPN',
		default: 'true',
	},
	RESIN_SUPERVISOR_PERSISTENT_LOGGING: {
		enum: ['false', 'true'],
		description:
			'Enable persistent logging. Only supported by supervisor versions >= v7.15.0.',
		default: 'false',
	},
	RESIN_SUPERVISOR_INSTANT_UPDATE_TRIGGER: {
		enum: ['false', 'true'],
		description:
			'Enable / Disable triggering updates instantly on startup or after pushing a release. Only supported by supervisor versions >= v9.13.0.',
		default: 'true',
	},
};

export const DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES: Array<{
	capableDeviceTypes: string[];
	properties: Dictionary<JSONSchema6Definition>;
}> = [
	{
		capableDeviceTypes: [
			'raspberry-pi',
			'raspberry-pi2',
			'raspberrypi3-64',
			'raspberrypi3',
			'raspberrypi4-64',
			'fincm3',
			'revpi-core-3',
			'npe-x500-m3',
		],
		properties: {
			RESIN_HOST_CONFIG_disable_splash: {
				enum: ['0', '1'],
				description: 'Enable / Disable the rainbow splash screen',
				default: '1',
			},
			RESIN_HOST_CONFIG_dtparam: {
				type: 'string',
				description: 'Define DT parameters',
				default: '"i2c_arm=on","spi=on","audio=on"',
			},
			RESIN_HOST_CONFIG_dtoverlay: {
				type: 'string',
				description: 'Define DT overlays',
				examples: ['"i2c-rtc,ds1307","lirc-rpi"'],
			},
			RESIN_HOST_CONFIG_enable_uart: {
				enum: ['0', '1'],
				description: 'Enable / Disable UART',
				default: '1',
			},
			RESIN_HOST_CONFIG_gpu_mem: {
				type: 'integer',
				description: 'Define device GPU memory in megabytes.',
				default: 16,
			},
		},
	},
	{
		capableDeviceTypes: ['up-board'],
		properties: {
			RESIN_HOST_CONFIGFS_ssdt: {
				type: 'string',
				description:
					'Define SSDT overlays. Only supported by supervisor versions >= v10.9.2.',
				examples: ['"spidev1.0","spidev1.1"'],
			},
		},
	},
];

const startsWithAny = (ns: string[], name: string) => {
	return ns.some((n) => name.startsWith(n));
};

const checkVarName = (type: string, name: string) => {
	if (INVALID_CHARACTER_REGEX.test(name)) {
		throw new BadRequestError(
			`${type} names can only contain alphanumeric characters and underscores.`,
		);
	}

	if (RESERVED_NAMES.includes(name)) {
		throw new BadRequestError(
			`${type}s ${RESERVED_NAMES.join(', ')} are reserved`,
		);
	}
};

export const checkConfigVarNameValidity = (name: string) => {
	checkVarName('Configuration variable', name);
	if (!startsWithAny(RESERVED_NAMESPACES, name)) {
		throw new BadRequestError(
			'Configuration variables must be part of one of the following namespaces: ' +
				RESERVED_NAMESPACES.join(', '),
		);
	}
};

export const checkEnvVarNameValidity = (name: string) => {
	checkVarName('Environment variable', name);

	if (startsWithAny(RESERVED_NAMESPACES, name)) {
		throw new BadRequestError(
			`Environment variables beginning with ${RESERVED_NAMESPACES.join(
				', ',
			)} are reserved.`,
		);
	}
};

export const checkEnvVarValueValidity = (value: string) => {
	if (INVALID_NEWLINE_REGEX.test(value)) {
		throw new BadRequestError(
			'Variable values cannot contain line break characters',
		);
	}
};
