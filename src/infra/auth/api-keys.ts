import type { Request } from 'express';

import { hooks, permissions, sbvrUtils } from '@balena/pinejs';

import { isJWT } from './jwt-passport';

const isRequest = (req: hooks.HookReq | Request): req is Request =>
	'get' in req;

export const getAPIKey = async (
	req: hooks.HookReq | Request,
	tx: Tx | undefined,
): Promise<sbvrUtils.ApiKey | undefined> => {
	const apiKey = await permissions.resolveApiKey(req, 'apikey', tx);
	if (apiKey != null) {
		return apiKey;
	}

	// Skip for Pine's request objects that don't support headers
	if (!isRequest(req)) {
		return;
	}

	// While this could be omitted, Pine will go to the DB in vain if not handled
	const token = (req.get('Authorization') || '').split(' ', 2)[1];
	if (token && !isJWT(token)) {
		// Add support for API keys on Authorization header if a JWT wasn't provided
		return await permissions.resolveAuthHeader(req, 'Bearer', tx);
	}
};

export const retrieveAPIKey = async (
	req: hooks.HookReq | Request,
	tx: Tx | undefined,
): Promise<void> => {
	// We should be able to skip this if req.user but doing so breaks the SDK
	// because it sends both a JWT and an API Key in requests like /devices/register
	const apiKey = await getAPIKey(req, tx);
	if (apiKey != null) {
		req.apiKey = apiKey;
	}
};
