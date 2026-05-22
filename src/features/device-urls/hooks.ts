import { sbvrUtils, hooks, permissions } from '@balena/pinejs';

import { checkDevicesCanHaveDeviceURL } from '../../features/application-types/application-types.js';

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { api, request } = args;
		if (request.values.is_web_accessible) {
			const deviceIds = await sbvrUtils.getAffectedIds(args);
			const rootApi = api.clone({
				passthrough: {
					req: permissions.rootRead,
				},
			});
			await checkDevicesCanHaveDeviceURL(rootApi, deviceIds);
		}
	},
});
