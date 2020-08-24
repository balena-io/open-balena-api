import type { Request } from 'express';
import * as _ from 'lodash';

import { hooks, permissions } from '@balena/pinejs';

import { isJWT } from './jwt-passport';

const isRequest = (req: hooks.HookReq | Request): req is Request =>
	'get' in req;

export const retrieveAPIKey = async (
	req: hooks.HookReq | Request,
): Promise<void> => {
	// We should be able to skip this if req.user but doing so breaks the SDK
	// because it sends both a JWT and an API Key in requests like /devices/register
	await permissions.apiKeyMiddleware(req);

	// Skip for Pine's request objects that don't support headers
	if (!isRequest(req)) {
		return;
	}

	// While this could be omitted, Pine will go to the DB in vain if not handled
	const token = (req.get('Authorization') || '').split(' ', 2)[1];
	if (token && !isJWT(token)) {
		// Add support for API keys on Authorization header if a JWT wasn't provided
		await permissions.authorizationMiddleware(req);
	}
};
