import { hooks } from '@balena/pinejs';

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTPARSE({ request }) {
		if (request.values.update_status !== undefined) {
			request.values.last_update_status_event = new Date();
		}
	},
});
