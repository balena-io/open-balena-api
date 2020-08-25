import { hooks } from '@balena/pinejs';

import { retrieveAPIKey } from '../infra/auth/api-keys';

hooks.addHook('all', 'all', 'all', {
	sideEffects: false,
	readOnlyTx: true,
	PREPARSE: async ({ req }) => {
		// Extend Pine's default behavior of calling apiKeyMiddleware()
		// support api keys on the Authorization header with Bearer scheme
		await retrieveAPIKey(req);
	},
});

import './resources/api_key';
import './resources/application';
import './resources/device';
import '../features/vars-schema/hooks';
import './resources/image';
import './resources/image__is_part_of__release';
import './resources/release';
import './resources/service';
import './resources/service_install';
import './resources/service_instance';
import './resources/tags';
import './resources/user';
