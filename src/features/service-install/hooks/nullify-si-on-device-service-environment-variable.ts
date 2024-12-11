import { hooks, type sbvrUtils } from '@balena/pinejs';

// TODO: Drop this once `device_service_environment_variable.service_install` gets removed from the sbvr
function backfillDeviceAndService({ request }: sbvrUtils.HookArgs<'resin'>) {
	delete request.values.service_install;
}

hooks.addPureHook('POST', 'resin', 'device_service_environment_variable', {
	POSTPARSE: backfillDeviceAndService,
});

hooks.addPureHook('PATCH', 'resin', 'device_service_environment_variable', {
	POSTPARSE: backfillDeviceAndService,
});
