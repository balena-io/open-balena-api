import type { JSONSchema6Definition } from 'json-schema';

import { errors } from '@balena/pinejs';

import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from '../../lib/config';

const { BadRequestError } = errors;

export const RESERVED_NAMES = ['RESIN', 'BALENA', 'USER'];

export const RESERVED_NAMESPACES = ['RESIN_', 'BALENA_'];

const addReservedPrefixes = (array: string[]) => {
	return RESERVED_NAMESPACES.flatMap((prefix) =>
		array.map((value) => prefix + value),
	);
};

// Config variables that are allowed to be set externally
// Note that this list will be mutated by the cloud API to add
// extra variables as for cloud-only features.
export const ALLOWED_NAMES = addReservedPrefixes([
	'APP_RESTART_POLICY',
	'APP_RESTART_RETRIES',
	'DEPENDENT_DEVICES_HOOK_ADDRESS',
	'OVERRIDE_LOCK',
	'SUPERVISOR_CONNECTIVITY_CHECK',
	'SUPERVISOR_HANDOVER_TIMEOUT',
	'SUPERVISOR_LOCAL_MODE',
	'SUPERVISOR_LOG_CONTROL',
	'SUPERVISOR_POLL_INTERVAL',
	'SUPERVISOR_UPDATE_STRATEGY',
	'SUPERVISOR_VPN_CONTROL',
	'SUPERVISOR_PERSISTENT_LOGGING',
	'SUPERVISOR_INSTANT_UPDATE_TRIGGER',
	'SUPERVISOR_HARDWARE_METRICS',
	'SUPERVISOR_DEVELOPMENT_MODE',
]);

// Config variable namespaces that are allowed to be set by frontend components
export const ALLOWED_NAMESPACES = addReservedPrefixes(['HOST_', 'UI_']);

// These env vars are allowed in the API but are set by other means
// (i.e. not directly as env vars from a frontend componenent).
// users must be blocked from setting them and they should be filtered out on display.
export const BLOCKED_NAMES = addReservedPrefixes([
	'RESTART',
	'DEVICE_RESTART',
	'SUPERVISOR_OVERRIDE_LOCK',
	'SUPERVISOR_NATIVE_LOGGER',
	'HOST_LOG_TO_DISPLAY',
]);

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
	RESIN_OVERRIDE_LOCK: {
		type: 'integer',
		enum: [0, 1],
		description:
			'Override the update lock if your app locked updates but is stuck in an invalid state.',
		default: 0,
	},
	BALENA_HOST_SPLASH_IMAGE: {
		type: 'string',
		format: 'data-url',
		description:
			'Define the PNG image to be used for the boot splash screen. Only supported by supervisor versions >= v12.3.0.',
		maxLength: 13400, // ~10KB base64 encoded image
	},
	BALENA_SUPERVISOR_HARDWARE_METRICS: {
		enum: ['false', 'true'],
		description:
			'Enable / Disable reporting device metrics such as CPU usage for bandwidth conservation. Only supported by supervisor versions >= v12.8.0.',
		default: 'true',
	},
	BALENA_SUPERVISOR_DEVELOPMENT_MODE: {
		enum: ['false', 'true'],
		description:
			'Enable / Disable development mode. Only supported by supervisor versions >= v12.9.5.',
		default: 'false',
	},
};

export const DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES: Array<{
	capableDeviceTypes: string[];
	properties: Dictionary<JSONSchema6Definition>;
}> = [
	{
		capableDeviceTypes: [
			'fincm3',
			'npe-x500-m3',
			'raspberry-pi',
			'raspberry-pi2',
			'raspberrypi3',
			'raspberrypi3-64',
			'raspberrypi4-64',
			'raspberrypi400-64',
			'raspberrypicm4-ioboard',
			'revpi-core-3',
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
			BALENA_HOST_CONFIG_hdmi_cvt: {
				type: 'string',
				description: 'Define a custom CVT mode for the HDMI',
				examples: ['480 360 60 1 0 0 0'],
			},
			BALENA_HOST_CONFIG_hdmi_force_hotplug: {
				type: 'integer',
				enum: [0, 1],
				description: 'Force the HDMI hotplug signal',
				default: 0,
			},
			BALENA_HOST_CONFIG_hdmi_group: {
				type: 'integer',
				description: 'Define the HDMI output group',
				examples: [2],
				default: 0,
			},
			BALENA_HOST_CONFIG_hdmi_mode: {
				type: 'integer',
				description: 'Define the HDMI output format',
				examples: [87],
				default: 1,
			},
			BALENA_HOST_CONFIG_display_rotate: {
				type: 'string',
				description: 'Define the rotation or flip of the display',
				examples: ['1', '0x10000'],
				default: '0',
			},
		},
	},
	{
		capableDeviceTypes: [
			'astro-tx2',
			'blackboard-tx2',
			'jetson-tx2',
			'n310-tx2',
			'n510-tx2',
			'orbitty-tx2',
			'spacely-tx2',
			'srd3-tx2',
		],
		properties: {
			RESIN_HOST_ODMDATA_configuration: {
				type: 'integer',
				oneOf: [
					{ const: 1, title: 'Configuration #1' },
					{ const: 2, title: 'Configuration #2' },
					{ const: 3, title: 'Configuration #3' },
					{ const: 4, title: 'Configuration #4' },
					{ const: 5, title: 'Configuration #5' },
					{ const: 6, title: 'Configuration #6' },
				],
				description:
					'Define the ODMDATA configuration. Only supported by supervisor versions >= v11.13.0.',
				default: 2,
			},
		},
	},
	{
		capableDeviceTypes: [
			'astro-tx2',
			'blackboard-tx2',
			'jetson-tx2',
			'n310-tx2',
			'n510-tx2',
			'orbitty-tx2',
			'spacely-tx2',
			'srd3-tx2',
			'jetson-nano',
			'jetson-nano-emmc',
			'jn30b-nano',
			'photon-nano',
		],
		properties: {
			RESIN_HOST_EXTLINUX_fdt: {
				type: 'string',
				description:
					'Define the file name of the DTB to be used. Only supported by supervisor versions >= v11.14.2.',
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
