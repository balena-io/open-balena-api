import { Request } from 'express';

import { sbvrUtils } from '@resin/pinejs';

import { getServiceFromRequest } from '../../lib/auth';
import { getIP } from '../../lib/utils';

sbvrUtils.addPureHook('POST', 'resin', 'service_instance', {
	POSTPARSE: ({ request, req }) => {
		request.values.service_type = getServiceFromRequest(req);
		request.values.ip_address = getIP(req as Request);
		// Service registration doubles up as a heartbeat
		request.values.last_heartbeat = new Date();
	},
});

sbvrUtils.addPureHook('PATCH', 'resin', 'service_instance', {
	POSTPARSE: ({ request }) => {
		if (request.values.is_alive) {
			request.values.last_heartbeat = new Date();
		}
	},
});
