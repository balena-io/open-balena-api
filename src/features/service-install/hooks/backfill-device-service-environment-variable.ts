import { hooks, errors, type sbvrUtils } from '@balena/pinejs';

async function backfillDeviceAndService({
	request,
	api,
}: sbvrUtils.HookArgs<'resin'>) {
	const { service_install: siId } = request.values;

	if (siId == null) {
		return;
	}

	const si = await api.get({
		resource: 'service_install',
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
}

hooks.addPureHook('POST', 'resin', 'device_service_environment_variable', {
	POSTPARSE: backfillDeviceAndService,
});

hooks.addPureHook('PATCH', 'resin', 'device_service_environment_variable', {
	POSTPARSE: backfillDeviceAndService,
});
