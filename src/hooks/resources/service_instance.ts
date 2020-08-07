import type { Request } from 'express';
import * as ipaddr from 'ipaddr.js';

import { sbvrUtils, errors } from '@balena/pinejs';

import { getServiceFromRequest } from '../../lib/auth';
import { getIP } from '../../lib/utils';

sbvrUtils.addPureHook('POST', 'resin', 'service_instance', {
	POSTPARSE: ({ request, req }) => {
		request.values.service_type = getServiceFromRequest(req);
		if (request.values.ip_address != null) {
			if (!ipaddr.isValid(request.values.ip_address)) {
				throw new errors.BadRequestError('Invalid ip address');
			}
		} else {
			request.values.ip_address = getIP(req as Request);
		}
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
