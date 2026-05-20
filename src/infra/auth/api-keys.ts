import type { hooks, sbvrUtils, types } from '@balena/pinejs';
import { permissions } from '@balena/pinejs';

import { isJWT } from './jwt-passport.js';
import type { RequestExcludingInput } from '../validation/index.js';

const getAPIKey = async (
	req:
		| types.OptionalField<hooks.HookReq, 'body' | 'query'>
		| RequestExcludingInput,
	tx: Tx | undefined,
): Promise<sbvrUtils.ApiKey | undefined> => {
	try {
		const apiKey =
			req.params.apikey ?? (req.query as Record<string, unknown>)?.apikey;
		if (apiKey != null) {
			return await permissions.checkApiKey(apiKey, tx);
		}
	} catch {
		// ignore
	}

	// Skip for Pine's request objects that don't support headers
	if (!('get' in req)) {
		return;
	}

	// While this could be omitted, Pine will go to the DB in vain if not handled
	const token = (req.get('Authorization') ?? '').split(' ', 2)[1];
	if (token && !isJWT(token)) {
		try {
			// Add support for API keys on Authorization header if a JWT wasn't provided
			return await permissions.resolveAuthHeader(req, tx, 'Bearer');
		} catch {
			// ignore
		}
	}
};

/**
 * Trigger a prefetch of the api key which is not awaited, stored in `req.prefetchApiKey`, which can be later consumed by `retrieveAPIKey`
 */
export const prefetchAPIKey = (
	req: Omit<hooks.HookReq, 'body' | 'query'> &
		Pick<RequestExcludingInput, 'prefetchApiKey'>,
	tx: Tx | undefined,
): void => {
	if (req.apiKey) {
		// If the api key is already set then we reuse/keep that
		req.prefetchApiKey = req.apiKey;
	} else {
		// Start the prefetch and let it run in the background - do not await it
		req.prefetchApiKey ??= getAPIKey(req, tx);
	}
};

/**
 * Ensure `req.apiKey` is set if it should be, using the prefetched apiKey if it exists
 */
export const retrieveAPIKey = async (
	req: Omit<hooks.HookReq, 'body' | 'query'> &
		Pick<RequestExcludingInput, 'prefetchApiKey'>,
	tx: Tx | undefined,
): Promise<void> => {
	prefetchAPIKey(req, tx);
	if (req.apiKey) {
		return;
	}
	req.apiKey ??= await req.prefetchApiKey;
};
