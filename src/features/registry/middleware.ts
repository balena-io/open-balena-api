import BasicAuth from 'basic-auth';
import type { RequestHandler } from 'express';

import { errors } from '@balena/pinejs';

import { retrieveAPIKey } from '../../infra/auth/api-keys.js';

import { TOKEN_AUTH_BUILDER_TOKEN } from '../../lib/config.js';

export class NoAuthProvidedError extends errors.UnauthorizedError {}

export class InvalidAuthProvidedError extends errors.UnauthorizedError {}

// Resolves permissions and populates req.user object, in case an api key is used
// in the password field of a basic authentication header. Also works with JWTs.
export const basicApiKeyAuthenticate: RequestHandler = async (
	req,
	res,
	next,
) => {
	const authHeader = req.headers['authorization'];
	if (authHeader != null) {
		const creds = BasicAuth.parse(authHeader);
		if (creds) {
			req.params.subject = creds.name;
			// This will later be parsed as an api key
			req.params.apikey = creds.pass;
			// So we need to delete any other api key parsing that may already have happened
			// TODO: Run this before any other api key parsing
			delete req.prefetchApiKey;
			delete req.apiKey;
		}
	}
	if (req.params.apikey === TOKEN_AUTH_BUILDER_TOKEN) {
		next();
		return;
	}
	try {
		await retrieveAPIKey(req, undefined);

		// Check whether the request was auth'd successfully and if not, see if some form
		// of credentials was provided and prevent requests with *invalid* credentials from
		// proceeding.
		//
		// Unfortunately, Pine has no way to let us determine auth failure was due to
		// invalid credentials or due to no credentials provided, so we need to jump over
		// some hoops here.
		//
		// In addition, there's ugly legacy that treats the builder's token as special,
		// granting it access to images unconditionally, bypassing permissions, so it causes
		// the check for permissions below to succeed and the request to fail with 401.
		if (
			(req.apiKey?.permissions == null ||
				req.apiKey.permissions.length === 0) &&
			req.user == null
		) {
			if (
				req.headers['authorization'] ??
				req.params['apikey'] ??
				req.body['apikey'] ??
				req.query['apikey']
			) {
				throw new InvalidAuthProvidedError();
			} else {
				throw new NoAuthProvidedError();
			}
		}

		next();
	} catch (err) {
		if (err instanceof NoAuthProvidedError) {
			next();
		} else if (err instanceof InvalidAuthProvidedError) {
			res.status(401).end();
		} else {
			next(err);
		}
	}
};
