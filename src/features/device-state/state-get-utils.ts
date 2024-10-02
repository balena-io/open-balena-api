import type { ExpandableStringKeyOf } from 'pinejs-client-core';
import type { dbModule, permissions } from '@balena/pinejs';
import { sbvrUtils, errors } from '@balena/pinejs';
import {
	DEFAULT_SUPERVISOR_POLL_INTERVAL,
	EMPTY_DEVICE_STATE_GET_DELAY_SECONDS,
} from '../../lib/config.js';
import {
	createMultiLevelStore,
	reqPermissionNormalizer,
} from '../../infra/cache/index.js';
import type { Device, Image, Service } from '../../balena-model.js';
import type { PickDeferred } from '@balena/abstract-sql-to-typescript';

export const getStateEventAdditionalFields: Array<
	Exclude<keyof Device['Read'], ExpandableStringKeyOf<Device['Read']>>
> = [];

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
	device:
		| {
				device_config_variable: EnvVarList;
				belongs_to__application: Array<{
					application_config_variable: EnvVarList;
				}>;
		  }
		| undefined,
	application = device?.belongs_to__application[0],
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

export function serviceInstallFromImage(
	device: {
		service_install: Array<{
			service: { __id: Service['Read']['id'] };
			device_service_environment_variable: EnvVarList;
		}>;
	},
	image:
		| {
				is_a_build_of__service: Array<Pick<Service['Read'], 'id'>>;
		  }
		// TODO: Drop me in the next major since v2 & v3 no longer pass this type of objects
		| PickDeferred<Image['Read'], 'is_a_build_of__service'>
		| undefined,
): (typeof device)['service_install'][number] | undefined;
export function serviceInstallFromImage(
	fleet: {
		service: Array<
			Pick<Service['Read'], 'id' | 'service_name'> & {
				service_environment_variable: EnvVarList;
				service_label: Array<{ label_name: string; value: string }>;
			}
		>;
	},
	image:
		| {
				is_a_build_of__service: Array<Pick<Service['Read'], 'id'>>;
		  }
		| undefined,
): (typeof fleet)['service'][number] | undefined;
export function serviceInstallFromImage(
	deviceOrFleet:
		| {
				service_install: Array<{
					service: { __id: Service['Read']['id'] };
					device_service_environment_variable: EnvVarList;
				}>;
		  }
		| {
				service: Array<
					Pick<Service['Read'], 'id' | 'service_name'> & {
						service_environment_variable: EnvVarList;
						service_label: Array<{ label_name: string; value: string }>;
					}
				>;
		  },
	image:
		| {
				is_a_build_of__service: Array<Pick<Service['Read'], 'id'>>;
		  }
		// TODO: Drop me in the next major since v2 & v3 no longer pass this type of objects
		| PickDeferred<Image['Read'], 'is_a_build_of__service'>
		| undefined,
) {
	if (image == null) {
		return;
	}

	const id =
		'__id' in image.is_a_build_of__service
			? image.is_a_build_of__service.__id
			: image.is_a_build_of__service[0].id;

	if ('service_install' in deviceOrFleet) {
		const device = deviceOrFleet;
		return device.service_install.find(({ service }) => service.__id === id);
	}
	if ('service' in deviceOrFleet) {
		const fleet = deviceOrFleet;
		return fleet.service.find((service) => service.id === id);
	}
}

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
) => sbvrUtils.db.readTransaction(...args);
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
