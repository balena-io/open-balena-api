import type { JSONSchema6 } from 'json-schema';

import { errors } from '@balena/pinejs';

import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from '../../lib/config.js';

const { BadRequestError } = errors;

export const RESERVED_NAMES = ['RESIN', 'BALENA', 'USER'];

export const RESERVED_NAMESPACES = ['RESIN_', 'BALENA_'];

const addReservedPrefixes = (array: string[]) => {
	return RESERVED_NAMESPACES.flatMap((prefix) =>
		array.map((value) => prefix + value),
	);
};

type ConfigVarDefinition = JSONSchema6 &
	Required<Pick<JSONSchema6, 'description'>> & {
		will_reboot?: boolean;
		warning?: string;
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

export const INVALID_ENV_VAR_REGEX = /^\d|\W/;
export const INVALID_CONFIG_VAR_REGEX = /^[\d:]|[^A-Za-z0-9_:]/;
export const INVALID_NEWLINE_REGEX = /\r|\n/;

const getDefinitionWithMinimumSupervisorVersion = (
	dtsPerSupervisorVersion: { [supervisorVersion: string]: string[] },
	definitions: Dictionary<ConfigVarDefinition>,
) => {
	return Object.entries(dtsPerSupervisorVersion).map(([version, dts]) => {
		return {
			capableDeviceTypes: dts,
			properties: Object.fromEntries(
				Object.entries(definitions).map(([key, definition]) => [
					key,
					{
						...definition,
						description: `${definition.description} Only supported by supervisor versions >= v${version}.`,
					},
				]),
			),
		};
	});
};
// Note that this list will be mutated by the cloud API to add
// extra variables as for cloud-only features.
export const SUPERVISOR_CONFIG_VAR_PROPERTIES: {
	[k: string]: ConfigVarDefinition;
} = {
	RESIN_SUPERVISOR_CONNECTIVITY_CHECK: {
		enum: ['false', 'true'],
		description: 'Enable / Disable Cloudlink connectivity check',
		default: 'true',
	},
	RESIN_SUPERVISOR_LOG_CONTROL: {
		enum: ['false', 'true'],
		description: 'Enable / Disable logs from being sent to balena API',
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
		description: 'Enable / Disable Cloudlink service on device',
		default: 'true',
	},
	RESIN_SUPERVISOR_PERSISTENT_LOGGING: {
		enum: ['false', 'true'],
		description:
			'Enable persistent logging. Only supported by supervisor versions >= v7.15.0.',
		will_reboot: true,
		default: 'false',
	},
	RESIN_SUPERVISOR_INSTANT_UPDATE_TRIGGER: {
		enum: ['false', 'true'],
		description:
			'Enable / Disable triggering updates instantly on startup or after pushing a release. Only supported by supervisor versions >= v9.13.0.',
		default: 'true',
	},
	BALENA_SUPERVISOR_OVERRIDE_LOCK: {
		type: 'integer',
		enum: [0, 1],
		description:
			'Override existing update lock(s) if your app is stuck in an invalid state under an update lock',
		default: 0,
	},
	BALENA_HOST_SPLASH_IMAGE: {
		type: 'string',
		format: 'data-url',
		description:
			'Define the PNG image to be used for the boot splash screen. Only supported by supervisor versions >= v12.3.0.',
		maxLength: 13400, // ~10KB base64 encoded image
		will_reboot: true,
		pattern: `^data:image/png;(?:name=(.*);)?base64,(.*)$`,
	},
	BALENA_SUPERVISOR_HARDWARE_METRICS: {
		enum: ['false', 'true'],
		description:
			'Enable / Disable reporting device metrics such as CPU usage for bandwidth conservation. Only supported by supervisor versions >= v12.8.0.',
		default: 'true',
	},
};

export const DEVICE_TYPE_SPECIFIC_CONFIG_VAR_PROPERTIES: Array<{
	capableDeviceTypes: string[];
	properties: Dictionary<ConfigVarDefinition>;
}> = [
	{
		capableDeviceTypes: [
			'fincm3',
			'npe-x500-m3',
			'raspberrypi0-2w-64',
			'raspberry-pi',
			'raspberry-pi2',
			'raspberrypi3',
			'raspberrypi3-64',
			'raspberrypi4-64',
			'raspberrypi400-64',
			'raspberrypicm4-ioboard',
			'raspberrypi5',
			'revpi-connect',
			'revpi-connect-s',
			'revpi-core-3',
			'revpi-connect-4',
		],
		properties: {
			RESIN_HOST_CONFIG_disable_splash: {
				enum: ['0', '1'],
				description:
					'Enable / Disable the splash screen to display image on boot.',
				will_reboot: true,
				default: '1',
			},
			RESIN_HOST_CONFIG_dtparam: {
				type: 'string',
				description: 'Define DT parameters for the default overlay.',
				will_reboot: true,
				default: '"i2c_arm=on","spi=on","audio=on"',
			},
			RESIN_HOST_CONFIG_dtoverlay: {
				type: 'string',
				description: 'Define DT overlays',
				will_reboot: true,
				examples: ['"i2c-rtc,ds1307","lirc-rpi"'],
			},
			RESIN_HOST_CONFIG_enable_uart: {
				enum: ['0', '1'],
				description: 'Enable / Disable UART',
				will_reboot: true,
				default: '1',
			},
			RESIN_HOST_CONFIG_gpu_mem: {
				type: 'integer',
				description: 'Define device GPU memory in megabytes.',
				will_reboot: true,
				default: 16,
			},
			RESIN_HOST_CONFIG_gpio: {
				type: 'string',
				description:
					'Allows GPIO pins to be set to specific modes and values at boot time.',
				will_reboot: true,
				examples: ['"19=op,dh","0-25=a2"'],
			},
			BALENA_HOST_CONFIG_hdmi_cvt: {
				type: 'string',
				description: 'Define a custom CVT mode for the HDMI',
				will_reboot: true,
				examples: ['480 360 60 1 0 0 0'],
			},
			BALENA_HOST_CONFIG_hdmi_force_hotplug: {
				type: 'integer',
				enum: [0, 1],
				description: 'Force the HDMI hotplug signal',
				will_reboot: true,
				default: 0,
			},
			BALENA_HOST_CONFIG_hdmi_group: {
				type: 'integer',
				description: 'Define the HDMI output group',
				examples: [2],
				will_reboot: true,
				default: 0,
			},
			BALENA_HOST_CONFIG_hdmi_mode: {
				type: 'integer',
				description: 'Define the HDMI output format',
				examples: [87],
				will_reboot: true,
				default: 1,
			},
			BALENA_HOST_CONFIG_display_rotate: {
				type: 'string',
				description: 'Define the rotation or flip of the display',
				examples: ['1', '0x10000'],
				will_reboot: true,
				default: '0',
			},
		},
	},
	...getDefinitionWithMinimumSupervisorVersion(
		{
			'11.13.0': [
				'astro-tx2',
				'blackboard-tx2',
				'jetson-tx2',
				'n310-tx2',
				'n510-tx2',
				'orbitty-tx2',
				'spacely-tx2',
				'srd3-tx2',
			],
		},
		{
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
					'Define the ODMDATA configuration to configure UPHY lanes.',
				will_reboot: true,
				default: 2,
			},
		},
	),
	...getDefinitionWithMinimumSupervisorVersion(
		{
			'11.14.2': [
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
				'jetson-nano-2gb-devkit',
				'floyd-nano',
				'jn30b-nano',
				'photon-nano',
				'jetson-tx2-nx-devkit',
				'photon-tx2-nx',
			],
			'14.0.8': ['imx8m-var-dart', 'imx8mm-var-dart'],
			'14.0.16': ['imx8mm-var-som'],
			'14.2.16': ['jetson-agx-orin-devkit', 'jetson-agx-orin-devkit-64gb'],
			'14.10.2': ['jetson-orin-nx-xavier-nx-devkit'],
			'14.11.11': ['jetson-orin-nano-devkit-nvme'],
		},
		{
			RESIN_HOST_EXTLINUX_fdt: {
				type: 'string',
				description: 'Define the file name of the DTB to be used.',
				will_reboot: true,
			},
		},
	),
	...getDefinitionWithMinimumSupervisorVersion(
		{
			'7.25.0': [
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
				'jetson-nano-2gb-devkit',
				'floyd-nano',
				'jn30b-nano',
				'photon-nano',
				'jetson-tx2-nx-devkit',
				'photon-tx2-nx',
			],
		},
		{
			RESIN_HOST_EXTLINUX_isolcpus: {
				type: 'string',
				description:
					'Allows to isolate CPU cores from the kernel scheduler by specifying CPU cores in the system starting from 0.',
				examples: ['0,2,3'],
				will_reboot: true,
			},
		},
	),
	...getDefinitionWithMinimumSupervisorVersion(
		{
			'10.9.2': ['up-board'],
		},
		{
			RESIN_HOST_CONFIGFS_ssdt: {
				type: 'string',
				description:
					'Define SSDT overlays. Only supported by supervisor versions >= v.',
				examples: ['"spidev1.0","spidev1.1"'],
				will_reboot: true,
			},
		},
	),
	...getDefinitionWithMinimumSupervisorVersion(
		{
			'14.6.0': [
				'raspberrypi4-64',
				'raspberrypi400-64',
				'raspberrypicm4-ioboard',
			],
		},
		{
			'BALENA_HOST_CONFIG_hdmi_force_hotplug:1': {
				type: 'integer',
				enum: [0, 1],
				description: 'Force the HDMI hotplug signal on HDMI port 2',
				will_reboot: true,
				default: 0,
			},
			'BALENA_HOST_CONFIG_hdmi_group:1': {
				type: 'integer',
				description: 'Define the HDMI output group on HDMI port 2',
				examples: [2],
				will_reboot: true,
				default: 0,
			},
			'BALENA_HOST_CONFIG_hdmi_mode:1': {
				type: 'integer',
				description: 'Define the HDMI output format on HDMI port 2 ',
				examples: [87],
				will_reboot: true,
				default: 1,
			},
		},
	),
	...getDefinitionWithMinimumSupervisorVersion(
		{
			'16.10.0': [
				'jetson-agx-orin-devkit',
				'jetson-agx-orin-devkit-64gb',
				'jetson-orin-nano-devkit-nvme',
				'jetson-orin-nano-seeed-j3010',
				'jetson-orin-nx-seeed-j4012',
				'jetson-orin-nx-xavier-nx-devkit',
			],
			'17.1.2': ['forecr-dsb-ornx-orin-nano-8gb'],
		},
		{
			BALENA_HOST_CONFIG_power_mode: {
				type: 'string',
				description:
					'Define the device power mode. Supported by OS with Jetpack 6 or higher.',
				examples: ['low', 'mid', 'high'],
				will_reboot: true,
			},
			BALENA_HOST_CONFIG_fan_profile: {
				type: 'string',
				description:
					'Define the device fan profile. Supported by OS with Jetpack 6 or higher.',
				examples: ['quiet', 'cool', 'default'],
				will_reboot: false,
			},
		},
	),
];

const startsWithAny = (ns: string[], name: string) => {
	return ns.some((n) => name.startsWith(n));
};

const checkAlphaNumericWithColon = (type: string, name: string) => {
	if (INVALID_CONFIG_VAR_REGEX.test(name)) {
		throw new BadRequestError(
			`${type} names can only contain alphanumeric characters, underscores or a colon`,
		);
	}
};

const checkVarName = (
	type: string,
	name: string,
	checkVarFormat = checkAlphaNumericWithColon,
) => {
	checkVarFormat(type, name);

	if (RESERVED_NAMES.includes(name)) {
		throw new BadRequestError(
			`${type}s ${RESERVED_NAMES.join(', ')} are reserved`,
		);
	}
};

const checkAlphaNumeric = (type: string, name: string) => {
	if (INVALID_ENV_VAR_REGEX.test(name)) {
		throw new BadRequestError(
			`${type} names can only contain alphanumeric characters and underscores.`,
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
	checkVarName('Environment variable', name, checkAlphaNumeric);

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
