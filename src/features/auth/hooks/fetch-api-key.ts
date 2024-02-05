import { hooks } from '@balena/pinejs';
import { retrieveAPIKey } from '../../../infra/auth/api-keys.js';

hooks.addHook('all', 'all', 'all', {
	sideEffects: false,
	readOnlyTx: true,
	PREPARSE: async ({ req }) => {
		// Extend Pine's default behavior of calling apiKeyMiddleware()
		// support api keys on the Authorization header with Bearer scheme
		await retrieveAPIKey(req, undefined);
	},
});
