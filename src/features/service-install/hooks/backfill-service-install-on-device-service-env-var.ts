import { hooks, errors, type sbvrUtils } from '@balena/pinejs';

async function backfillServiceInstall({
	request,
	api,
}: sbvrUtils.HookArgs<'resin'>) {
	const { device: deviceId, service: serviceId } = request.values;

	if (deviceId == null && serviceId == null) {
		return;
	}

	if (
		(deviceId == null && serviceId != null) ||
		(deviceId != null && serviceId == null)
	) {
		throw new errors.BadRequestError(
			'Both or none of device and service must be specified',
		);
	}

	let si = await api.get({
		resource: 'service_install',
		id: {
			device: deviceId,
			installs__service: serviceId,
		},
		options: {
			$select: ['id'],
		},
	});

	if (si == null) {
		si = await api.post({
			resource: 'service_install',
			body: {
				device: deviceId,
				installs__service: serviceId,
			},
		});
	}

	if (si == null) {
		throw new errors.BadRequestError(
			`No service install exists for device: ${deviceId} and service ${serviceId} and one could not be created`,
		);
	}

	request.values.service_install = si.id;
}

hooks.addPureHook('POST', 'resin', 'device_service_environment_variable', {
	POSTPARSE: backfillServiceInstall,
});

hooks.addPureHook('PATCH', 'resin', 'device_service_environment_variable', {
	POSTPARSE: backfillServiceInstall,
});
