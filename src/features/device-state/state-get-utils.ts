import _ from 'lodash';
import * as semver from 'balena-semver';
import { sbvrUtils, dbModule } from '@balena/pinejs';
import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from '../../lib/config';

const defaultConfigVariableFns: Array<(config: Dictionary<string>) => void> = [
	function setMinPollInterval(config) {
		const pollInterval =
			config.RESIN_SUPERVISOR_POLL_INTERVAL == null
				? 0
				: parseInt(config.RESIN_SUPERVISOR_POLL_INTERVAL, 10);
		// Multicontainer supervisor requires the poll interval to be a string
		config.RESIN_SUPERVISOR_POLL_INTERVAL =
			'' + Math.max(pollInterval, DEFAULT_SUPERVISOR_POLL_INTERVAL);
	},
];
export const addDefaultConfigVariableFn = (
	fn: typeof defaultConfigVariableFns[number],
) => {
	defaultConfigVariableFns.push(fn);
};
export const setDefaultConfigVariables = (config: Dictionary<string>): void => {
	for (const fn of defaultConfigVariableFns) {
		fn(config);
	}
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
	deviceOrFleet: AnyObject,
	image?: AnyObject,
): undefined | AnyObject => {
	if (image == null) {
		return;
	}

	let id: number;
	if (typeof image.is_a_build_of__service === 'object') {
		id = image.is_a_build_of__service.__id;
	} else {
		id = image.is_a_build_of__service;
	}

	if ('service_install' in deviceOrFleet) {
		return _.find(
			deviceOrFleet.service_install,
			(si) => si.service[0].id === id,
		);
	} else if ('service' in deviceOrFleet) {
		return deviceOrFleet.service.find(
			(fleetService: AnyObject) => fleetService.id === id,
		);
	}
};

export const formatImageLocation = (imageLocation: string) =>
	imageLocation.toLowerCase();

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
};

let $readTransaction: dbModule.Database['readTransaction'] = (
	...args: Parameters<dbModule.Database['readTransaction']>
) => sbvrUtils.db.readTransaction!(...args);
export const setReadTransaction = (
	newReadTransaction: dbModule.Database['readTransaction'],
) => {
	$readTransaction = newReadTransaction;
};
export const readTransaction: dbModule.Database['readTransaction'] = (
	...args: Parameters<dbModule.Database['readTransaction']>
) => $readTransaction(...args);

export const rejectUiConfig = (name: string) =>
	!/^(BALENA|RESIN)_UI/.test(name);

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (
	varList: EnvVarList,
	obj: Dictionary<string>,
	filterFn: (name: string) => boolean = () => true,
) => {
	for (const { name, value } of varList) {
		if (filterFn(name)) {
			obj[name] = value;
		}
	}
};

// These 2 config vars below are mapped to labels if missing for backwards-compatibility
// See: https://github.com/resin-io/hq/issues/1340
export const ConfigurationVarsToLabels = {
	RESIN_SUPERVISOR_UPDATE_STRATEGY: 'io.resin.update.strategy',
	RESIN_SUPERVISOR_HANDOVER_TIMEOUT: 'io.resin.update.handover-timeout',
};
