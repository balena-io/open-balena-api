import { hooks } from '@balena/pinejs';
import { getDeviceTypes } from '../device-types-list.js';

hooks.addPureHook('POST', 'resin', 'application', {
	POSTRUN: async ({ request }) => {
		if (request.values.is_host) {
			// no need to wait for the cache invalidation
			void getDeviceTypes.delete();
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: async ({ request }) => {
		const affectedIds = request.affectedIds!;
		if (request.values.is_host && affectedIds.length !== 0) {
			// no need to wait for the cache invalidation
			void getDeviceTypes.delete();
		}
	},
});
