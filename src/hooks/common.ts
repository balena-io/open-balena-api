import { sbvrUtils } from '@resin/pinejs';
import * as deviceTypes from '../lib/device-types';
import { PinejsClient } from '../platform';

export const resolveDeviceType = async (
	api: PinejsClient,
	request: sbvrUtils.HookRequest,
	fkValue: string,
): Promise<deviceTypes.DeviceType> => {
	if (request.values.device_type != null && request.values[fkValue] == null) {
		// translate device_type to is_for__device_type
		const dt = await deviceTypes.getDeviceTypeIdBySlug(
			api,
			request.values.device_type,
		);
		if (!dt) {
			throw new deviceTypes.UnknownDeviceTypeError(request.values.device_type);
		}
		request.values[fkValue] = dt.id;
	}

	if (!request.values[fkValue]) {
		throw new deviceTypes.InvalidDeviceTypeError();
	}

	const dt = (await api.get({
		resource: 'device_type',
		id: request.values[fkValue],
		options: {
			$select: ['slug'],
		},
	})) as { slug: string };

	if (!dt) {
		throw new deviceTypes.InvalidDeviceTypeError();
	}
	// set device_type_slug in case the FK column was used.
	request.values.device_type = dt.slug;
	return deviceTypes.findBySlug(api, dt.slug);
};
