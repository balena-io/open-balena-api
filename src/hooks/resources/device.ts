import * as _ from 'lodash';

import { sbvrUtils, hooks, permissions } from '@balena/pinejs';

import { checkDevicesCanHaveDeviceURL } from '../../features/application-types/application-types';

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { api, request } = args;
		if (request.values.is_web_accessible) {
			const rootApi = api.clone({
				passthrough: {
					req: permissions.root,
				},
			});
			const deviceIds = await sbvrUtils.getAffectedIds(args);
			await checkDevicesCanHaveDeviceURL(rootApi, deviceIds);
		}
	},
});
