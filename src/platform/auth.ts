import type { Request, RequestHandler, Response } from 'express';
import * as _ from 'lodash';
import * as base32 from 'thirty-two';

import { sbvrUtils } from '@resin/pinejs';
import type { Tx } from '@resin/pinejs/out/database-layer/db';

import { retrieveAPIKey } from './api-keys';
import { createJwt, SignOptions, User } from './jwt';

import { getIP, pseudoRandomBytesAsync } from '../lib/utils';
import type { User as DbUser } from '../models';

const {
	BadRequestError,
	ConflictError,
	UnauthorizedError,
	NotFoundError,
	InternalRequestError,
	root,
	api,
} = sbvrUtils;

const SUDO_TOKEN_VALIDITY = 20 * 60 * 1000;

const USERNAME_BLACKLIST = ['root'];

export const userHasPermission = (
	user: undefined | sbvrUtils.User,
	permission: string,
): boolean => {
	if (user == null || user.permissions == null) {
		return false;
	}
	return user.permissions.includes(permission);
};

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
};

// Think twice before using this function as it *unconditionally* sets the
// password for the given user to the given string. This function will also
// generate a new token secret, effectively invalidating all current login
// sessions.
export const setPassword = async (
	user: AnyObject,
	newPassword: string,
	tx?: Tx,
) => {
	const newJwtSecret = await generateNewJwtSecret();
	await api.resin.patch({
		resource: 'user',
		id: user.id,
		passthrough: {
			req: root,
			tx,
		},
		body: {
			password: newPassword,
			jwt_secret: newJwtSecret,
			// erase password_reset_code once we have user-provided password
			password_reset_code: null,
			can_reset_password_until__expiry_date: null,
		},
	});
};

// Conditionally updates the password for the given user if it differs from
// the one currently stored, using `setPassword()` which means that function's
// caveats apply here as well.
export const updatePasswordIfNeeded = async (
	usernameOrEmail: string,
	newPassword: string,
	tx?: Tx,
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
): Promise<void> => {
	const user = (await api.resin.get({
		resource: 'user',
		id: userId,
		passthrough: {
			req: root,
		},
		options: {
			$select: ['password', 'id'],
		},
	})) as Pick<DbUser, 'password' | 'id'>;
	if (user == null) {
		throw new BadRequestError('User not found.');
	}

	const passwordIsOk = await comparePassword(password, user.password);
	if (!passwordIsOk) {
		throw new BadRequestError('Current password incorrect.');
	}
};

export const generateNewJwtSecret = async (): Promise<string> => {
	// Generate a new secret and save it, to invalidate sessions using the old secret.
	// Length is a multiple of 20 to encode without padding.
	const key = await pseudoRandomBytesAsync(20);
	return base32.encode(key).toString();
};

export const sudoMiddleware: RequestHandler = async (req, res, next) => {
	try {
		const user = await getUser(req, false);
		const notAuthBefore = Date.now() - SUDO_TOKEN_VALIDITY;
		if (user && user.authTime && user.authTime > notAuthBefore) {
			next();
			return;
		} else {
			res.status(401).json({ error: 'Fresh authentication token required' });
		}
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// If adding/removing fields, please also update `User`
// in "typings/common.d.ts".
export const userFields = [
	'id',
	'username',
	'email',
	'created_at',
	'jwt_secret',
];

export const tokenFields = _.clone(userFields);

interface ExtraParams {
	existingToken?: Partial<User>;
	jwtOptions?: SignOptions;
}

export type GetUserTokenDataFn = (
	userId: number,
	existingToken?: Partial<User>,
) => PromiseLike<AnyObject>;

export function setUserTokenDataCallback(fn: GetUserTokenDataFn) {
	$getUserTokenDataCallback = fn;
}

let $getUserTokenDataCallback: GetUserTokenDataFn = async (
	userId,
	existingToken,
): Promise<User> => {
	const [userData, permissionData] = await Promise.all([
		api.resin.get({
			resource: 'user',
			id: userId,
			passthrough: { req: root },
			options: {
				$select: tokenFields,
			},
		}) as Promise<AnyObject>,
		sbvrUtils.getUserPermissions(userId),
	]);
	if (!userData || !permissionData) {
		throw new Error('No data found?!');
	}
	const newTokenData: Partial<User> = _.pick(userData, tokenFields);

	const tokenData = {
		...existingToken,
		...newTokenData,
		permissions: permissionData,
	} as User;

	if (!_.isFinite(tokenData.authTime)) {
		tokenData.authTime = Date.now();
	}

	// skip nullish attributes
	return _.omitBy(tokenData, _.isNil) as User;
};

export const createSessionToken = async (
	userId: number,
	{ existingToken, jwtOptions }: ExtraParams = {},
): Promise<string> => {
	const tokenData = await $getUserTokenDataCallback(userId, existingToken);
	return createJwt(tokenData, jwtOptions);
};

const sendXHRToken = (res: Response, token: string, statusCode = 200): void => {
	res.header('content-type', 'text/plain');
	res.status(statusCode).send(token);
};

export const loginUserXHR = async (
	res: Response,
	userId: number,
	statusCode?: number,
	extraParams?: ExtraParams,
): Promise<void> => {
	const token = await createSessionToken(userId, extraParams);
	sendXHRToken(res, token, statusCode);
};

export const updateUserXHR = async (
	res: Response,
	req: Request,
): Promise<void> => {
	await getUser(req, false);
	if (req.creds == null || !('id' in req.creds) || req.creds.id == null) {
		throw new InternalRequestError('No user present');
	}
	const token = await createSessionToken(req.creds.id, {
		existingToken: req.creds,
	});
	sendXHRToken(res, token);
};

export const reqHasPermission = (req: Request, permission: string): boolean =>
	userHasPermission(req.apiKey || req.user, permission);

const getUserQuery = api.resin.prepare<{ key: string }>({
	resource: 'user',
	passthrough: { req: root },
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
});
export function getUser(
	req: Request | sbvrUtils.HookReq,
	required?: true,
): Promise<User>;
export function getUser(
	req: Request | sbvrUtils.HookReq,
	required: false,
): Promise<User | undefined>;
export async function getUser(
	req: sbvrUtils.HookReq & {
		user?: User;
		creds?: User;
	},
	required = true,
): Promise<User | undefined> {
	await retrieveAPIKey(req);
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

	let key;
	if (req.apiKey != null) {
		key = req.apiKey.key;
	}
	if (!key) {
		if (required) {
			throw new UnauthorizedError('Request has no JWT or API key');
		}
		return;
	}

	const [user] = (await getUserQuery({ key })) as AnyObject[];
	if (user) {
		// Store it in `req` to be compatible with JWTs and for caching
		req.user = req.creds = _.pick(user, userFields) as User;
	} else if (required) {
		throw new UnauthorizedError('User not found for API key');
	}
	return req.user;
}

export const defaultFindUser$select = [
	'id',
	'actor',
	'username',
	'password',
] as const;

export async function findUser(
	loginInfo: string,
	tx?: Tx,
): Promise<Pick<DbUser, typeof defaultFindUser$select[number]> | undefined>;
export async function findUser<
	T extends DbUser,
	TProps extends ReadonlyArray<keyof T>
>(
	loginInfo: string,
	tx: Tx | undefined,
	$select: TProps,
): Promise<Pick<T, typeof $select[number]> | undefined>;
export async function findUser<
	T extends DbUser,
	TProps extends ReadonlyArray<keyof T & string>
>(
	loginInfo: string,
	tx?: Tx,
	$select: TProps = (defaultFindUser$select as ReadonlyArray<
		keyof DbUser & string
	>) as TProps,
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

	type UserResult = Pick<T, typeof $select[number]>;
	const [user] = (await api.resin.get({
		resource: 'user',
		passthrough: {
			req: root,
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
			$select: $select as Writable<typeof $select>,
		},
	})) as [UserResult?];
	return user;
}

export const registerUser = async (
	userData: AnyObject & {
		username: string;
		email: string;
		password?: string;
	},
	tx: Tx,
	req?: Request,
): Promise<AnyObject> => {
	if (USERNAME_BLACKLIST.includes(userData.username)) {
		throw new ConflictError('This username is blacklisted');
	}
	let existingUser = await findUser(userData.email, tx, ['id']);
	if (existingUser) {
		throw new ConflictError('This email is already taken');
	}

	existingUser = await findUser(userData.username, tx, ['id']);
	if (existingUser) {
		throw new ConflictError('This username is already taken');
	}

	const encodedKey = await generateNewJwtSecret();

	let clientIP;
	if (req) {
		clientIP = getIP(req);
	}

	// Create the user in the platform
	const user = (await api.resin.post({
		resource: 'user',
		body: {
			...userData,
			jwt_secret: encodedKey,
		},
		passthrough: {
			tx,
			req: root,
			custom: {
				clientIP,
			},
		},
	})) as AnyObject;

	if (user.id == null) {
		throw new Error('Error creating user in the platform');
	}
	return user;
};
