import * as _ from 'lodash';

import * as semver from 'balena-semver';

import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from '../../lib/config';

// Set RESIN_SUPERVISOR_POLL_INTERVAL to a minimum of 10 minutes
export const setMinPollInterval = (config: AnyObject): void => {
	const pollInterval =
		config.RESIN_SUPERVISOR_POLL_INTERVAL == null
			? 0
			: parseInt(config.RESIN_SUPERVISOR_POLL_INTERVAL, 10);
	// Multicontainer supervisor requires the poll interval to be a string
	config.RESIN_SUPERVISOR_POLL_INTERVAL =
		'' + Math.max(pollInterval, DEFAULT_SUPERVISOR_POLL_INTERVAL);
};

export const getReleaseForDevice = (
	device: AnyObject,
): AnyObject | undefined => {
	if (device.should_be_running__release[0] != null) {
		return device.should_be_running__release[0];
	}
	return device.belongs_to__application[0]?.should_be_running__release[0];
};

export const serviceInstallFromImage = (
	device: AnyObject,
	image?: AnyObject,
): undefined | AnyObject => {
	if (image == null) {
		return;
	}

	let id: number;
	if (Array.isArray(image.is_a_build_of__service)) {
		id = image.is_a_build_of__service[0].id;
	} else {
		id = image.is_a_build_of__service.__id;
	}

	if (isNaN(id)) {
		return;
	}

	return _.find(device.service_install, (si) => si.service[0].id === id);
};

export const formatImageLocation = (imageLocation: string) =>
	imageLocation.toLowerCase();

export type DeviceConfigHook = (
	configVars: Dictionary<string>,
	osVersion: string,
) => void;

export interface HookRegistry {
	deviceConfig: DeviceConfigHook[];
}

const STATE_ENDPOINT_HOOKS: HookRegistry = {
	deviceConfig: [],
};

export function registerHook<Key extends keyof HookRegistry>(
	name: Key,
	fn: typeof STATE_ENDPOINT_HOOKS[Key][number],
) {
	STATE_ENDPOINT_HOOKS[name].push(fn);
}

function runHook<Key extends keyof HookRegistry>(
	name: Key,
	args: Parameters<typeof STATE_ENDPOINT_HOOKS[Key][number]>,
) {
	STATE_ENDPOINT_HOOKS[name].forEach((hook) =>
		hook(...(args as Parameters<typeof hook>)),
	);
}

// Some config vars cause issues with certain versions of resinOS.
// This function will check the OS version against the config
// vars and filter any which cause problems, returning a new map to
// be sent to the device.
//
// `configVars` should be in the form { [name: string]: string }
export const filterDeviceConfig = (
	configVars: Dictionary<string>,
	osVersion: string,
): void => {
	// ResinOS >= 2.x has a read-only file system, and this var causes the
	// supervisor to run `systemctl enable|disable [unit]`, which does not
	// persist over reboots. This causes the supervisor to go into a reboot
	// loop, so filter out this var for these os versions.
	if (semver.gte(osVersion, '2.0.0')) {
		delete configVars.RESIN_HOST_LOG_TO_DISPLAY;
	}

	runHook('deviceConfig', [configVars, osVersion]);
};
