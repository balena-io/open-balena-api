import statuses from 'statuses';
import { errors, hooks, sbvrUtils } from '@balena/pinejs';
import { getDeviceTypeBySlug } from '../../features/device-types/device-types';

const addReadOnlyHook = (
	methods: Array<Parameters<typeof hooks.addHook>[0]>,
	resource: string,
	hook: sbvrUtils.Hooks,
) => {
	methods.map((method) => {
		hooks.addHook(method, 'v6', resource, {
			...hook,
			sideEffects: false,
			readOnlyTx: true,
		});
	});
};

const translateDeviceTypeTo =
	(toField: string) =>
	async ({ request, api }: sbvrUtils.HookArgs) => {
		if (Object.prototype.hasOwnProperty.call(request.values, 'device_type')) {
			const resinApi = sbvrUtils.api.resin.clone({
				passthrough: api.passthrough,
			});
			const dt = await getDeviceTypeBySlug(
				resinApi,
				request.values.device_type,
			);

			delete request.values.device_type;
			request.values[toField] = dt.id;
		}
	};

addReadOnlyHook(['POST'], 'application', {
	POSTPARSE: translateDeviceTypeTo('is_for__device_type'),
});
addReadOnlyHook(['POST'], 'device', {
	POSTPARSE: translateDeviceTypeTo('is_of__device_type'),
});

addReadOnlyHook(['PUT', 'POST', 'PATCH'], 'application', {
	async POSTPARSE({ request }) {
		// Dependent device properties were removed so we block trying to set them
		if (request.values.depends_on__application != null) {
			throw new errors.BadRequestError();
		}
	},
});
addReadOnlyHook(['PUT', 'POST', 'PATCH'], 'device', {
	async POSTPARSE({ request }) {
		// Dependent device properties were removed so we block trying to set them
		if (request.values.is_managed_by__device != null) {
			throw new errors.BadRequestError();
		}
	},
});

const releaseTypeToIsFinalMap = {
	draft: false,
	final: true,
};
addReadOnlyHook(['PUT', 'POST', 'PATCH'], 'release', {
	async POSTPARSE({ request }) {
		const { release_type, is_final } = request.values;
		if (typeof release_type === 'string') {
			if (!(release_type in releaseTypeToIsFinalMap)) {
				throw new errors.BadRequestError(
					'It is necessary that each release has a release type that is "final" or "draft".',
				);
			}
			const translatedIsFinal =
				releaseTypeToIsFinalMap[
					release_type as keyof typeof releaseTypeToIsFinalMap
				];
			if (is_final != null && is_final !== translatedIsFinal) {
				throw new errors.BadRequestError(
					'Conflict between the provided is_final and release_type values',
				);
			}
			request.values.is_final = translatedIsFinal;
			delete request.values.release_type;
		}
	},
});

addReadOnlyHook(['PUT', 'POST', 'PATCH'], 'release', {
	async POSTPARSE({ request }) {
		if (!Object.prototype.hasOwnProperty.call(request.values, 'contract')) {
			return;
		}
		try {
			request.values.contract =
				typeof request.values.contract === 'object'
					? request.values.contract
					: JSON.parse(request.values.contract);
		} catch (err) {
			throw new errors.BadRequestError(
				'Failed to parse provided release.contract value',
			);
		}
	},
});

addReadOnlyHook(['all'], 'all', {
	async PRERESPOND({ response }) {
		if (response.body == null) {
			// Use the default body message for the status code when the body is empty
			// to support clients that checked the body rather than status code for old versions
			response.body = statuses.message[response.statusCode];
		}
	},
});
