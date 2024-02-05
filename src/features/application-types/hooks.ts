import { hooks } from '@balena/pinejs';
import { checkDeviceCanBeInApplication } from './application-types.js';

hooks.addPureHook('POST', 'resin', 'device', {
	POSTRUN: async ({ api, request }) => {
		await checkDeviceCanBeInApplication(
			api,
			request.values.belongs_to__application,
			request.values,
		);
	},
});
