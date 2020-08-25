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

import './resources/application';
import './resources/device';
import './resources/service_instance';
import './resources/user';

import '../features/ci-cd/hooks';
import '../features/cascade-delete/hooks';
import '../features/dependent-devices/hooks';
import '../features/tags/hooks';
import '../features/vars-schema/hooks';
