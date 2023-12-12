import _ from 'lodash';
import { sbvrUtils, dbModule, permissions, errors } from '@balena/pinejs';
import {
	DEFAULT_SUPERVISOR_POLL_INTERVAL,
	EMPTY_DEVICE_STATE_GET_DELAY_SECONDS,
} from '../../lib/config';
import {
	createMultiLevelStore,
	reqPermissionNormalizer,
} from '../../infra/cache';
import type { Device } from '../../balena-model';

// eslint-disable-next-line @typescript-eslint/no-empty-interface -- This needs to be an interface so that downstream projects can extend it.
export interface GetStateEventStoredDeviceFields
	extends Pick<Device, 'public_address'> {}

// We do not use "satisfies" or "as const" so that downstream projects can augment this list.
export const getStateEventAdditionalFields: Array<
	keyof GetStateEventStoredDeviceFields
> = [
	// TODO: Remove the public_address from this list in the next major since it's not used by oB-api and downstream projects can set it if needed.
	'public_address',
];

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
	fn: (typeof defaultConfigVariableFns)[number],
) => {
	defaultConfigVariableFns.push(fn);
};
export const setDefaultConfigVariables = (config: Dictionary<string>): void => {
	for (const fn of defaultConfigVariableFns) {
		fn(config);
	}
};

export const getConfig = (
	device: AnyObject | undefined,
	application: AnyObject = device?.belongs_to__application[0],
) => {
	const config: Dictionary<string> = {};

	// add any app-specific config values...

	if (application) {
		varListInsert(
			application.application_config_variable,
			config,
			rejectUiConfig,
		);
	}

	// override with device-specific values...
	if (device) {
		varListInsert(device.device_config_variable, config, rejectUiConfig);
	}

	filterDeviceConfig(config);
	setDefaultConfigVariables(config);

	return config;
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
export const filterDeviceConfig = (configVars: Dictionary<string>): void => {
	// ResinOS >= 2.x has a read-only file system, and this var causes the
	// supervisor to run `systemctl enable|disable [unit]`, which does not
	// persist over reboots. This causes the supervisor to go into a reboot
	// loop, so filter out this var for these os versions.
	delete configVars.RESIN_HOST_LOG_TO_DISPLAY;
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

export const getStateDelayingEmpty = (() => {
	const lastFailedDeviceStateTime = createMultiLevelStore<number>(
		'lastFailedDeviceStateTime',
		{
			ttl: EMPTY_DEVICE_STATE_GET_DELAY_SECONDS,
		},
		false,
	);
	const EMPTY_DEVICE_STATE_GET_DELAY =
		EMPTY_DEVICE_STATE_GET_DELAY_SECONDS * 1000;

	/**
	 * This runs the provided getStateFn and returns the result, with a timeout before repeating the
	 * request for a null/empty response. It also throws an UnauthorizedError if the result is null
	 * Note: This only caches empty responses as they have succeeded but the requester is not able to
	 * see the specific device, vs a thrown error which might happen due to some outside issue (eg db timeouts)
	 */
	return <T>(
			getStateFn: (
				req: permissions.PermissionReq,
				uuid: string,
			) => Promise<T | undefined>,
		) =>
		async (req: permissions.PermissionReq, uuid: string): Promise<T> => {
			const key = `${uuid}$${reqPermissionNormalizer(req)}`;
			const lastFail = await lastFailedDeviceStateTime.get(key);
			// If the entry has expired then it means we should actually do the fetch
			if (
				lastFail == null ||
				lastFail + EMPTY_DEVICE_STATE_GET_DELAY < Date.now()
			) {
				const result = await getStateFn(req, uuid);
				if (result == null) {
					// If the fetch failed we add a new entry to delay the next attempt
					await lastFailedDeviceStateTime.set(key, Date.now());
					// And throw an unauthorized error for the failure
					throw new errors.UnauthorizedError();
				}

				return result;
			}
			throw new errors.UnauthorizedError();
		};
})();
