import * as _ from 'lodash';
import { createJwt, SignOptions } from './jwt';
import { retrieveAPIKey } from './api-keys';
import { Tx, sbvrUtils, resinApi, root } from './index';
import * as Promise from 'bluebird';
import * as crypto from 'crypto';
import * as base32 from 'thirty-two';

import { RequestHandler, Response, Request } from 'express';
import { InternalRequestError } from '@resin/pinejs/out/sbvr-api/errors';

const pseudoRandomBytesAsync = Promise.promisify(crypto.pseudoRandomBytes);

const { BadRequestError, ConflictError, UnauthorizedError } = sbvrUtils;

const SUDO_TOKEN_VALIDITY = 20 * 60 * 1000;

export const userHasPermission = (
	user: undefined | sbvrUtils.User,
	permission: string,
): boolean => {
	if (user == null) {
		return false;
	}
	return _.includes(user.permissions, permission);
};

export const checkUserPassword = (
	password: string,
	userId: number,
): Promise<void> =>
	resinApi
		.get({
			resource: 'user',
			id: userId,
			passthrough: {
				req: root,
			},
			options: {
				$select: ['password', 'id'],
			},
		})
		.then((user: AnyObject) => {
			if (user == null) {
				throw new BadRequestError('User not found.');
			}

			const hash = user.password;
			return sbvrUtils.sbvrTypes.Hashed.compare(password, hash).then(
				passwordIsOk => {
					if (!passwordIsOk) {
						throw new BadRequestError('Current password incorrect.');
					}
				},
			);
		});

export const generateNewJwtSecret = (): Promise<string> =>
	// Generate a new secret and save it, to invalidate sessions using the old secret.
	// Length is a multiple of 20 to encode without padding.
	pseudoRandomBytesAsync(20).then(key => base32.encode(key).toString());

export const sudoMiddleware: RequestHandler = (req, res, next) =>
	getUser(req, false)
		.then(user => {
			const notAuthBefore = Date.now() - SUDO_TOKEN_VALIDITY;
			if (user && user.authTime && user.authTime > notAuthBefore) {
				next();
				return null;
			} else {
				res.status(401).json({ error: 'Fresh authentication token required' });
			}
		})
		.catch(err => {
			res.status(500).json({ error: err.message });
		});

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

export interface GetUserTokenDataFn {
	(userId: number, existingToken?: Partial<User>): PromiseLike<AnyObject>;
}

export function setUserTokenDataCallback(fn: GetUserTokenDataFn) {
	$getUserTokenDataCallback = fn;
}

let $getUserTokenDataCallback: GetUserTokenDataFn = (userId, existingToken) => {
	const userData = resinApi.get({
		resource: 'user',
		id: userId,
		passthrough: { req: root },
	});

	const permissionData = sbvrUtils.getUserPermissions(userId);

	return Promise.join(
		userData,
		permissionData,
		(userData: AnyObject, permissionData) => {
			if (!userData || !permissionData) {
				throw new Error('No data found?!');
			}
			const newTokenData: Partial<User> = _.pick(userData, tokenFields);

			let tokenData = {
				...existingToken,
				...newTokenData,
				...{ permissions: permissionData },
			} as User;

			if (!_.isFinite(tokenData.authTime)) {
				tokenData.authTime = Date.now();
			}

			// skip nullish attributes
			return _.omitBy(tokenData, _.isNil) as User;
		},
	);
};

export const createSessionToken = (
	userId: number,
	{ existingToken, jwtOptions }: ExtraParams = {},
): Promise<string> => {
	return Promise.resolve($getUserTokenDataCallback(userId, existingToken)).then(
		tokenData => createJwt(tokenData, jwtOptions),
	);
};

const sendXHRToken = (res: Response, statusCode = 200) => (
	token: string,
): void => {
	res.header('content-type', 'text/plain');
	res.status(statusCode).send(token);
};

export const loginUserXHR = (
	res: Response,
	userId: number,
	statusCode?: number,
	extraParams?: ExtraParams,
): Promise<void> =>
	createSessionToken(userId, extraParams).then(sendXHRToken(res, statusCode));

export const updateUserXHR = (res: Response, req: Request): Promise<void> =>
	getUser(req, false)
		.then(() => {
			if (req.creds == null || !('id' in req.creds) || req.creds.id == null) {
				throw new InternalRequestError('No user present');
			}
			return createSessionToken(req.creds.id, { existingToken: req.creds });
		})
		.then(sendXHRToken(res));

export const reqHasPermission = (req: Request, permission: string): boolean =>
	userHasPermission(req.apiKey || req.user, permission);

export function getUser(
	req: Request | sbvrUtils.HookReq,
	required?: true,
): Promise<User>;
export function getUser(
	req: Request | sbvrUtils.HookReq,
	required: false,
): Promise<User | undefined>;
export function getUser(
	req: sbvrUtils.HookReq & {
		user?: User;
		creds?: User;
	},
	required = true,
): Promise<User | undefined> {
	return retrieveAPIKey(req).then(() => {
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

		return resinApi
			.get({
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
													k: { key },
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
			})
			.then(([user]: AnyObject[]) => {
				if (user) {
					// Store it in `req` to be compatible with JWTs and for caching
					req.user = req.creds = _.pick(user, userFields) as User;
				} else if (required) {
					throw new UnauthorizedError('User not found for API key');
				}
				return req.user;
			});
	});
}

export const findUser = (
	loginInfo: string,
	tx?: Tx,
): Promise<AnyObject | undefined> => {
	if (!loginInfo) {
		return Promise.resolve(undefined);
	}

	let loginField;
	if (_.includes(loginInfo, '@')) {
		loginField = 'email';
	} else {
		loginField = 'username';
	}
	return resinApi
		.get({
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
				$select: ['id', 'actor', 'username', 'password'],
			},
		})
		.then(([user]: AnyObject[]) => user);
};

export const registerUser = (
	userData: AnyObject & {
		username: string;
		email: string;
		password?: string;
	},
	tx: Tx,
): Promise<AnyObject> => {
	return findUser(userData.email, tx)
		.then(existingUser => {
			if (existingUser) {
				throw new ConflictError('This email is already taken');
			}
			return findUser(userData.username, tx);
		})
		.then(existingUser => {
			if (existingUser) {
				throw new ConflictError('This username is already taken');
			}
			return generateNewJwtSecret();
		})
		.then(encodedKey => {
			// Create the user in the platform
			return resinApi.post({
				resource: 'user',
				body: {
					...userData,
					jwt_secret: encodedKey,
				},
				passthrough: {
					tx,
					req: root,
				},
			});
		})
		.tap((user: AnyObject) => {
			if (user.id == null) {
				throw new Error('Error creating user in the platform');
			}
		});
};
