import type { Request } from 'express';
import _ from 'lodash';

import type { hooks } from '@balena/pinejs';
import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import { retrieveAPIKey } from './api-keys.js';
import type { ResolvedUserPayload } from './jwt-passport.js';

import { getIP } from '../../lib/utils.js';
import type { User } from '../../balena-model.js';
import type {
	PickDeferred,
	Deferred,
} from '@balena/abstract-sql-to-typescript';

const { BadRequestError, UnauthorizedError, NotFoundError } = errors;
const { api } = sbvrUtils;

export const userHasPermission = (
	user: undefined | sbvrUtils.Actor,
	permission: string,
): boolean => {
	if (user?.permissions == null) {
		return false;
	}
	return user.permissions.includes(permission);
};

export type GetNewUserRoleFunction = (user: AnyObject) => string;

let getNewUserRole: GetNewUserRoleFunction = () => 'default-user';

export const setRegistrationRoleFunc = (
	registerFunc: GetNewUserRoleFunction,
) => {
	getNewUserRole = registerFunc;
};

export const getRegistrationRole: typeof getNewUserRole = (user) =>
	getNewUserRole(user);

/**
 * A known invalid comparisson to emulate a wrong password error.
 * Used to prevent exposing information via timing attacks.
 */
const runInvalidPasswordComparison = () =>
	sbvrUtils.sbvrTypes.Hashed.compare(
		'',
		'$2b$10$Wj6ud7bYmcAw4B1uuORsnuYODUKSkrH6dVwG1zoUhDeTCjwsxlp5.',
	);

export const comparePassword = (password: string, hash: string | null) =>
	hash == null
		? runInvalidPasswordComparison()
		: sbvrUtils.sbvrTypes.Hashed.compare(password, hash);

export const validatePassword = (password?: string) => {
	if (!password) {
		throw new BadRequestError('Password required.');
	}
	if (password.length < 8) {
		throw new BadRequestError('Password must be at least 8 characters.');
	}
	if (64 < password.length) {
		// OWASP: Avoid long password DoS attacks
		throw new BadRequestError('Password must be at most 64 characters.');
	}
};

// Think twice before using this function as it *unconditionally* sets the
// password for the given user to the given string. Changing a user password
// will also generate a new token secret, effectively invalidating all current
// login sessions.
export const setPassword = async (
	user: Pick<User['Read'], 'id'>,
	newPassword: string,
	tx: Tx,
) => {
	await api.resin.patch({
		resource: 'user',
		id: user.id,
		passthrough: {
			req: permissions.root,
			tx,
		},
		body: {
			password: newPassword,
		},
	});
};

// Conditionally updates the password for the given user if it differs from
// the one currently stored, using `setPassword()` which means that function's
// caveats apply here as well.
export const updatePasswordIfNeeded = async (
	usernameOrEmail: string,
	newPassword: string,
	tx: Tx,
): Promise<boolean> => {
	const user = await findUser(usernameOrEmail, tx);
	if (user == null) {
		throw new NotFoundError('User not found.');
	}

	const match = await comparePassword(newPassword, user.password);
	if (match) {
		return false;
	}
	try {
		await setPassword(user, newPassword, tx);
		return true;
	} catch {
		return false;
	}
};

export const checkUserPassword = async (
	password: string,
	userId: number,
	tx: Tx,
): Promise<void> => {
	const user = await api.resin.get({
		resource: 'user',
		id: userId,
		passthrough: {
			req: permissions.root,
			tx,
		},
		options: {
			$select: ['password', 'id'],
		},
	});
	if (user == null) {
		throw new BadRequestError('User not found.');
	}

	const passwordIsOk = await comparePassword(password, user.password);
	if (!passwordIsOk) {
		throw new BadRequestError('Current password incorrect.');
	}
};

export const reqHasPermission = (
	req: Pick<Request, 'apiKey' | 'user'>,
	permission: string,
): boolean => userHasPermission(req.apiKey ?? req.user, permission);

// If adding/removing fields, please also update `User`
// in "typings/common.d.ts".
export const userFields = ['id', 'actor', 'jwt_secret'] satisfies Array<
	keyof User['Read']
>;

const getUserQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'user',
			passthrough: { req: permissions.root },
			options: {
				$select: userFields,
				$filter: {
					actor: {
						$any: {
							$alias: 'a',
							$expr: {
								a: {
									api_key: {
										$any: {
											$alias: 'k',
											$expr: {
												k: { key: { '@': 'key' } },
											},
										},
									},
								},
							},
						},
					},
				},
				$top: 1,
			},
		},
		{ key: ['string'] },
	),
);

export function getUser(
	req: Request | hooks.HookReq,
	txParam: Tx | undefined,
	required?: true,
): Promise<ResolvedUserPayload>;
export function getUser(
	req: Request | hooks.HookReq,
	txParam: Tx | undefined,
	required: false,
): Promise<ResolvedUserPayload | undefined>;
export async function getUser(
	req: hooks.HookReq & Pick<Request, 'user' | 'creds'>,
	/** You should always be passing a Tx, unless you are using this in a middleware. */
	txParam: Tx | undefined,
	required = true,
): Promise<ResolvedUserPayload | undefined> {
	const $getUser = async (tx: Tx) => {
		// This shouldn't happen but it does for some internal PineJS requests
		if (req.user && !req.creds) {
			req.creds = req.user;
		}

		// JWT or API key already loaded
		if (req.creds) {
			if (required && !req.user) {
				throw new UnauthorizedError('User has not been authorized');
			}
			// If partial user, promise will resolve to `null` user
			return req.user;
		}

		await retrieveAPIKey(req, tx);
		const key = req.apiKey?.key;
		if (!key) {
			if (required) {
				throw new UnauthorizedError('Request has no JWT or API key');
			}
			return;
		}

		const [user] = await getUserQuery()({ key }, undefined, { tx });
		if (user) {
			// Store it in `req` to be compatible with JWTs and for caching
			req.user = req.creds = {
				..._.pick(user, userFields),
				// Explicitly mark that we didn't run 2fa checks if it's eg an api key
				twoFactorRequired: undefined,
				actor: user.actor.__id,
			};
		} else if (required) {
			throw new UnauthorizedError('User not found for API key');
		}
		return req.user;
	};

	if (txParam == null) {
		return await sbvrUtils.db.readTransaction($getUser);
	}

	return await $getUser(txParam);
}

export const defaultFindUser$select = [
	'id',
	'actor',
	'username',
	'password',
] satisfies Array<keyof User['Read']>;

export async function findUser(
	loginInfo: string,
	tx: Tx,
): Promise<
	| PickDeferred<User['Read'], (typeof defaultFindUser$select)[number]>
	| undefined
>;
export async function findUser<TProps extends Array<keyof User['Read']>>(
	loginInfo: string,
	tx: Tx,
	$select: TProps,
): Promise<PickDeferred<User['Read'], (typeof $select)[number]> | undefined>;
export async function findUser<TProps extends Array<keyof User['Read']>>(
	loginInfo: string,
	tx: Tx,
	$select: TProps = defaultFindUser$select as TProps,
) {
	if (!loginInfo) {
		return;
	}

	let loginField;
	if (loginInfo.includes('@')) {
		loginField = 'email';
	} else {
		loginField = 'username';
	}

	const [user] = await api.resin.get({
		resource: 'user',
		passthrough: {
			req: permissions.root,
			tx,
		},
		options: {
			$filter: {
				$eq: [
					{
						$tolower: { $: loginField },
					},
					{
						$tolower: loginInfo,
					},
				],
			},
			$select,
		},
	});
	return user;
}

export const registerUser = async (
	userData: AnyObject & {
		username: string;
		email: string | null;
		password?: string;
	},
	tx: Tx,
	req?: Request,
	// This should be able to be `PickDeferred<User['Read']>` but it needs to be inlined
	// to avoid issues around typescript's maximum serialization length.
): Promise<{ [P in keyof User['Read']]: Deferred<User['Read'][P]> }> => {
	let clientIP;
	if (req) {
		clientIP = getIP(req);
	}

	// Create the user in the platform
	const user = await api.resin.post({
		resource: 'user',
		body: {
			...userData,
		},
		passthrough: {
			tx,
			req: permissions.root,
			custom: {
				clientIP,
			},
		},
	});

	if (user.id == null) {
		throw new Error('Error creating user in the platform');
	}
	return user;
};
