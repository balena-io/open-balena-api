import { sbvrUtils, hooks, errors } from '@balena/pinejs';
import { captureException } from '../../infra/error-handling';
import { getDeviceTypeBySlug } from './device-types';

const { BadRequestError, ConflictError } = errors;

export const resolveDeviceType = async (
	api: sbvrUtils.PinejsClient,
	request: sbvrUtils.HookRequest,
	fkValue: string,
): Promise<void> => {
	if (request.values.device_type != null && request.values[fkValue] == null) {
		// translate device_type to is_for__device_type
		const dtBySlug = await getDeviceTypeBySlug(api, request.values.device_type);
		request.values[fkValue] = dtBySlug.id;
	}

	if (!request.values[fkValue]) {
		throw new BadRequestError();
	}

	const dt = (await api.get({
		resource: 'device_type',
		id: request.values[fkValue],
		options: {
			$select: ['slug'],
		},
	})) as { slug: string } | undefined;

	if (!dt) {
		throw new BadRequestError();
	}
	// set device_type_slug in case the FK column was used.
	request.values.device_type = dt.slug;
};

hooks.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: async (args) => {
		const { req, request, api } = args;

		try {
			await resolveDeviceType(api, request, 'is_for__device_type');
		} catch (err) {
			if (!(err instanceof ConflictError)) {
				captureException(err, 'Error in application postparse hook', { req });
			}
			throw err;
		}
	},
});

hooks.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: ({ api, request }) =>
		resolveDeviceType(api, request, 'is_of__device_type'),
});
