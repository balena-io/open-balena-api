import { hooks } from '@balena/pinejs';
import { sbvrUtils } from '@balena/pinejs';
import { DeviceType } from '../../device-types/device-types';

// We currently don't have a good way to check the family of a device type, so we have agreed to hard-code it for now.
// We have scheduled an arch call to discuss how to handle default config in a more generic manner.
const rpiBasedDeviceTypes = [
	'fincm3',
	'npe-x500-m3',
	'raspberrypi',
	'raspberrypi2',
	'raspberrypi3',
	'raspberrypi3-64',
	'raspberrypi4-64',
	'revpi-core-3',
];

const isRpiBased = async (
	deviceTypeId: number,
	api: sbvrUtils.PinejsClient,
) => {
	const deviceType = (await api.get({
		resource: 'device_type',
		id: deviceTypeId,
		options: {
			$select: 'slug',
		},
	})) as DeviceType | undefined;
	if (deviceType) {
		return rpiBasedDeviceTypes.includes(deviceType.slug);
	}

	return false;
};

// We want to set a default gpu mem value for all RPI applications
hooks.addPureHook('POST', 'resin', 'application', {
	POSTRUN: async ({ request, result: appId, api }) => {
		const deviceTypeId: number = request.values.is_for__device_type;
		if (!(await isRpiBased(deviceTypeId, api))) {
			return;
		}

		await api.post({
			resource: 'application_config_variable',
			body: {
				application: appId,
				name: 'BALENA_HOST_CONFIG_gpu_mem',
				value: '16',
			},
			options: { returnResource: false },
		});
	},
});
