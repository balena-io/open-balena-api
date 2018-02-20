import * as Promise from 'bluebird';
import { readdir } from 'fs';
import { sbvrUtils } from '../platform';
import { retrieveAPIKey } from '../platform/api-keys';

const readdirAsync = Promise.promisify(readdir);

sbvrUtils.addPureHook('all', 'all', 'all', {
	PREPARSE: ({ req }) => {
		// Extend Pine's default behavior of calling apiKeyMiddleware()
		// support api keys on the Authorization header with Bearer scheme
		return retrieveAPIKey(req);
	},
});

readdirAsync(__dirname + '/resources').each(initScript => {
	if (/\.ts$/.test(initScript)) {
		return require(__dirname + '/resources/' + initScript);
	}
});
