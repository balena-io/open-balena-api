import { sbvrUtils } from '@balena/pinejs';

import { getDeviceTypeIdBySlug } from '../lib/device-types';
import { UnknownDeviceTypeError, InvalidDeviceTypeError } from '../lib/errors';

export const resolveDeviceType = async (
	api: sbvrUtils.PinejsClient,
	request: sbvrUtils.HookRequest,
	fkValue: string,
): Promise<void> => {
	if (request.values.device_type != null && request.values[fkValue] == null) {
		// translate device_type to is_for__device_type
		const dtBySlug = await getDeviceTypeIdBySlug(
			api,
			request.values.device_type,
		);
		if (!dtBySlug) {
			throw new UnknownDeviceTypeError(request.values.device_type);
		}
		request.values[fkValue] = dtBySlug.id;
	}

	if (!request.values[fkValue]) {
		throw new InvalidDeviceTypeError();
	}

	const dt = (await api.get({
		resource: 'device_type',
		id: request.values[fkValue],
		options: {
			$select: ['slug'],
		},
	})) as { slug: string } | undefined;

	if (!dt) {
		throw new InvalidDeviceTypeError();
	}
	// set device_type_slug in case the FK column was used.
	request.values.device_type = dt.slug;
};
