import { sbvrUtils, errors, permissions } from '@balena/pinejs';
import * as semver from 'balena-semver';

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

export const DefaultApplicationType: ApplicationType = {
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

export class DeviceOSVersionIsTooLow extends errors.ForbiddenError {
	constructor(
		message = 'Device OS version is too low for the application type.',
	) {
		super(message);
	}
}

export class WebUrlNotSupportedError extends errors.ForbiddenError {
	constructor(message = 'The application type does not support web url.') {
		super(message);
	}
}

export const checkDevicesCanHaveDeviceURL = async (
	api: sbvrUtils.PinejsClient,
	deviceIDs: number[],
): Promise<void> => {
	if (deviceIDs.length === 0) {
		return;
	}
	const violators = await api.get({
		resource: 'application_type',
		options: {
			$top: 1,
			$select: 'id',
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
	});

	if (violators.length > 0) {
		throw new WebUrlNotSupportedError();
	}
};

const getAppType = async (api: sbvrUtils.PinejsClient, appId: number) => {
	const [appType] = await api.get({
		resource: 'application_type',
		passthrough: {
			req: permissions.root,
		},
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
	});
	return appType;
};

export const checkDeviceCanBeInApplication = async (
	api: sbvrUtils.PinejsClient,
	appId: number,
	device: AnyObject,
) => {
	const appType = await getAppType(api, appId);
	if (appType?.needs__os_version_range == null) {
		return;
	}
	checkVersion(device, appType);
};

export const checkDevicesCanBeInApplication = async (
	api: sbvrUtils.PinejsClient,
	appId: number,
	deviceIds: number[],
): Promise<void> => {
	const appType = await getAppType(api, appId);
	if (appType?.needs__os_version_range == null) {
		return;
	}

	const devices = await api.get({
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
	});

	for (const device of devices) {
		checkVersion(device, appType);
	}
};

const checkVersion = (device: AnyObject, appType: AnyObject) => {
	if (device.os_version == null && device.supervisor_version != null) {
		throw new DeviceOSVersionIsTooLow(
			`Device ${device.device_name} is too old to satisfy required version range: ${appType.needs__os_version_range}`,
		);
	}
	if (
		device.os_version != null &&
		!semver.satisfies(device.os_version, appType.needs__os_version_range)
	) {
		throw new DeviceOSVersionIsTooLow(
			`Device ${device.device_name} has OS version ${device.os_version} but needs to satisfy version range: ${appType.needs__os_version_range}`,
		);
	}
};
