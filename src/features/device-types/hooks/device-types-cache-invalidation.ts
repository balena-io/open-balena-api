import { hooks } from '@balena/pinejs';
import { getDeviceTypeJsons } from '../device-types-list.js';

hooks.addPureHook('POST', 'resin', 'device_type', {
	POSTRUN: ({ request, result }) => {
		if (typeof result !== 'number') {
			return;
		}
		console.log(
			`[device-types]: New device_type ${request.values.slug} was created, invalidating device-types cache.`,
		);
		// no need to wait for the cache invalidation
		void getDeviceTypeJsons.delete();
	},
});

hooks.addPureHook('POST', 'resin', 'application', {
	POSTRUN: ({ request }) => {
		if (request.values.is_host) {
			console.log(
				`[device-types]: New hostApp ${request.values.slug} was created, invalidating device-types cache.`,
			);
			// no need to wait for the cache invalidation
			void getDeviceTypeJsons.delete();
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: ({ request }) => {
		const affectedIds = request.affectedIds!;
		if (request.values.is_host && affectedIds.length !== 0) {
			console.log(
				`[device-types]: Application(s) ${affectedIds.join(',')} were marked as host, invalidating device-types cache.`,
			);
			// no need to wait for the cache invalidation
			void getDeviceTypeJsons.delete();
		}
	},
});
