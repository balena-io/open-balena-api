import type { RequestHandler } from 'express';
import { type permissions, sbvrUtils } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
} from '../../infra/error-handling/index.js';
import { augmentReqApiKeyPermissions } from '../api-keys/lib.js';

export const defaultGetAuthorizedKeysFn = async (
	req: permissions.PermissionReq,
	username: string,
) => {
	// Augment with the ability to resolve the user's username for this request only, there's no need
	// for device keys to have the ability by default. Access to the public key will still be restricted
	// by `user__has__public_key` so this only affects the ability to resolve the username they apply to
	req = augmentReqApiKeyPermissions(req, ['resin.user.read']);
	const data = await sbvrUtils.api.resin.get({
		resource: 'user__has__public_key',
		options: {
			$select: 'public_key',
			$filter: {
				user: {
					$any: {
						$alias: 'u',
						$expr: {
							u: { username },
						},
					},
				},
			},
		},
		passthrough: { req },
	});

	return data.map((e) => e.public_key).join('\n');
};

let getAuthorizedKeys = defaultGetAuthorizedKeysFn;
/**
 * Set the function used to get the authorized keys for a user.
 */
export const setGetAuthorizedKeysFn = (
	$getAuthorizedKeys: typeof getAuthorizedKeys,
) => {
	getAuthorizedKeys = $getAuthorizedKeys;
};

export const getUserPublicKeys: RequestHandler = async (req, res) => {
	const { username } = req.params;

	if (username == null) {
		return res.status(400).end();
	}
	try {
		const authorizedKeys = await getAuthorizedKeys(req, username);
		res.status(200).send(authorizedKeys);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting public keys');
		res.status(500).end();
	}
};
