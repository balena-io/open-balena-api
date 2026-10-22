import { hooks, sbvrUtils, errors } from '@balena/pinejs';

const addReadOnlyHook = (
	methods: Array<Parameters<typeof hooks.addHook>[0]>,
	resource: string,
	hook: sbvrUtils.Hooks<'v7'>,
) => {
	methods.map((method) => {
		hooks.addHook(method, 'v7', resource, {
			...hook,
			sideEffects: false,
			readOnlyTx: true,
		});
	});
};

addReadOnlyHook(
	['POST', 'PATCH', 'PUT'],
	'device_service_environment_variable',
	{
		POSTPARSE: async ({ request, api }) => {
			const { service_install: siId } = request.values;

			if (siId == null) {
				return;
			}

			const si = await sbvrUtils.api.resin.get({
				resource: 'service_install',
				passthrough: api.passthrough,
				id: siId,
				options: {
					$select: ['device', 'service'],
				},
			});

			if (si == null) {
				throw new errors.UnauthorizedError();
			}

			request.values.device = si.device.__id;
			request.values.service = si.service.__id;
		},
	},
);
