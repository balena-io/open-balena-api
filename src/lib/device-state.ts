import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as semver from 'resin-semver';

import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from './env-vars';

import { PinejsClient } from '../platform';

// Set RESIN_SUPERVISOR_POLL_INTERVAL to a minimum of 10 minutes
export const setMinPollInterval = (config: AnyObject) => {
	const pollInterval =
		config.RESIN_SUPERVISOR_POLL_INTERVAL == null
			? 0
			: parseInt(config.RESIN_SUPERVISOR_POLL_INTERVAL);
	// Multicontainer supervisor requires the poll interval to be a string
	config.RESIN_SUPERVISOR_POLL_INTERVAL =
		'' + Math.max(pollInterval, DEFAULT_SUPERVISOR_POLL_INTERVAL);
};

export const getReleaseForDevice = (
	api: PinejsClient,
	device: AnyObject,
	singleContainer = false,
): Promise<AnyObject> => {
	if (device.should_be_running__release[0] != null) {
		return Promise.resolve(device.should_be_running__release[0]);
	} else {
		const app = device.belongs_to__application[0];
		return releaseFromApp(api, app, singleContainer);
	}
};

export const releaseFromApp = (
	api: PinejsClient,
	app: AnyObject,
	singleContainer = false,
) => {
	let containsImgObj = {};
	if (singleContainer) {
		containsImgObj = { $top: 1 };
	}
	return api
		.get({
			resource: 'release',
			options: {
				$select: ['id', 'commit', 'composition'],
				$expand: {
					contains__image: _.merge(containsImgObj, {
						$select: 'id',
						$expand: {
							image: {
								$select: [
									'id',
									'is_stored_at__image_location',
									'is_a_build_of__service',
									'content_hash',
								],
							},
							image_environment_variable: {
								$select: ['name', 'value'],
							},
							image_label: {
								$select: ['label_name', 'value'],
							},
						},
					}),
				},
				$filter: {
					status: 'success',
					commit: app.commit,
					belongs_to__application: app.id,
				},
			},
		})
		.then(([release]: AnyObject[]) => release);
};

export const serviceInstallFromImage = (
	device: AnyObject,
	image?: AnyObject,
): undefined | AnyObject => {
	if (image == null) {
		return;
	}

	let id: number;
	if (_.isObject(image.is_a_build_of__service)) {
		id = image.is_a_build_of__service.__id;
	} else {
		id = image.is_a_build_of__service;
	}

	return _.find(device.service_install, si => si.service[0].id === id);
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
): Dictionary<string> => {
	// ResinOS >= 2.x has a read-only file system, and this var causes the
	// supervisor to run `systemctl enable|disable [unit]`, which does not
	// persist over reboots. This causes the supervisor to go into a reboot
	// loop, so filter out this var for these os versions.
	if (semver.gte(osVersion, '2.0.0')) {
		return _.omit(configVars, 'RESIN_HOST_LOG_TO_DISPLAY');
	}
	return configVars;
};
