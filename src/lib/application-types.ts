import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as resinSemver from 'resin-semver';

import { sbvrUtils } from '@resin/pinejs';

export interface ApplicationType {
	id?: number;
	name: string;
	slug: string;

	supports_web_url: boolean;
	supports_multicontainer: boolean;
	supports_gateway_mode: boolean;
	requires_payment: boolean;
	is_legacy: boolean;
	needs__os_version_range: null | string;
	maximum_device_count: null | number;
	description: string;
}

export const Default: ApplicationType = {
	name: 'Default',
	slug: 'default',
	supports_web_url: false,
	supports_multicontainer: true,
	supports_gateway_mode: true,
	requires_payment: false,
	is_legacy: false,
	needs__os_version_range: '>=2.11.0',
	maximum_device_count: null,
	description:
		'Default application type, allowing multiple containers and gateway mode.',
};

export class DeviceOSVersionIsTooLow extends sbvrUtils.ForbiddenError {
	constructor(
		message = 'Device OS version is too low for the application type.',
	) {
		super(message);
	}
}

export class WebUrlNotSupportedError extends sbvrUtils.ForbiddenError {
	constructor(message = 'The application type does not support web url.') {
		super(message);
	}
}

export const checkDevicesCanHaveDeviceURL = (
	api: sbvrUtils.PinejsClient,
	deviceIDs: number[],
): Promise<void> => {
	if (deviceIDs.length === 0) {
		return Promise.resolve();
	}
	return api
		.get({
			resource: 'application_type/$count',
			options: {
				$top: 1,
				$select: 'supports_web_url',
				$filter: {
					is_of__application: {
						$any: {
							$alias: 'a',
							$expr: {
								a: {
									owns__device: {
										$any: {
											$alias: 'd',
											$expr: {
												d: {
													id: { $in: deviceIDs },
												},
											},
										},
									},
								},
							},
						},
					},
					supports_web_url: false,
				},
			},
		})
		.then((violators: number) => {
			if (violators > 0) {
				throw new WebUrlNotSupportedError();
			}
		});
};

export const checkDevicesCanBeInApplication = (
	api: sbvrUtils.PinejsClient,
	appId: number,
	deviceIds: number[],
): Promise<void> => {
	return api
		.get({
			resource: 'application_type',
			options: {
				$select: ['needs__os_version_range'],
				$filter: {
					is_of__application: {
						$any: {
							$alias: 'a',
							$expr: {
								a: {
									id: appId,
								},
							},
						},
					},
				},
			},
		})
		.then(([appType]: AnyObject[]) => {
			if (_.isEmpty(appType) || _.isEmpty(appType.needs__os_version_range)) {
				return;
			}

			return api
				.get({
					resource: 'device',
					options: {
						$select: ['os_version', 'supervisor_version', 'device_name'],
						$filter: {
							id: { $in: deviceIds },
							$or: {
								os_version: { $ne: null },
								supervisor_version: { $ne: null },
							},
						},
					},
				})
				.then((devices: AnyObject[]) => {
					for (const device of devices) {
						if (
							device.os_version == null &&
							device.supervisor_version != null
						) {
							throw new DeviceOSVersionIsTooLow(
								`Device ${device.device_name} is too old to satisfy required version range: ${appType.needs__os_version_range}`,
							);
						}
						if (
							device.os_version != null &&
							!resinSemver.satisfies(
								device.os_version,
								appType.needs__os_version_range,
							)
						) {
							throw new DeviceOSVersionIsTooLow(
								`Device ${device.device_name} has OS version ${device.os_version} but needs to satisfy version range: ${appType.needs__os_version_range}`,
							);
						}
					}
				})
				.return();
		});
};
