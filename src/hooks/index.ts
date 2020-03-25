import { sbvrUtils } from '@resin/pinejs';

import { retrieveAPIKey } from '../platform/api-keys';

sbvrUtils.addPureHook('all', 'all', 'all', {
	PREPARSE: ({ req }) => {
		// Extend Pine's default behavior of calling apiKeyMiddleware()
		// support api keys on the Authorization header with Bearer scheme
		return retrieveAPIKey(req);
	},
});

import './resources/api_key';
import './resources/application';
import './resources/device';
import './resources/envvars';
import './resources/image';
import './resources/image__is_part_of__release';
import './resources/release';
import './resources/service';
import './resources/service_install';
import './resources/service_instance';
import './resources/tags';
import './resources/user';
