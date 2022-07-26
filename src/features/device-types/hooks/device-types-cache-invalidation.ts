import { hooks } from '@balena/pinejs';
import { getDeviceTypes } from '../device-types-list';

hooks.addPureHook('POST', 'resin', 'application', {
	POSTRUN: async ({ request }) => {
		if (request.values.is_host) {
			getDeviceTypes.delete();
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: async ({ request }) => {
		const affectedIds = request.affectedIds!;
		if (request.values.is_host && affectedIds.length !== 0) {
			getDeviceTypes.delete();
		}
	},
});
