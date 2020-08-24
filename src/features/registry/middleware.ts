import * as BasicAuth from 'basic-auth';
import type { RequestHandler } from 'express';

import { retrieveAPIKey } from '../../infra/auth/api-keys';

// Resolves permissions and populates req.user object, in case an api key is used
// in the password field of a basic authentication header
export const basicApiKeyAuthenticate: RequestHandler = async (
	req,
	_res,
	next,
) => {
	const creds = BasicAuth.parse(req.headers['authorization']!);
	if (creds) {
		req.params.subject = creds.name;
		req.params.apikey = creds.pass;
	}
	try {
		await retrieveAPIKey(req);
		next();
	} catch (err) {
		next(err);
	}
};
