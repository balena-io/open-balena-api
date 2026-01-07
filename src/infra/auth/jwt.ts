import type { Request, Response } from 'express';

import _ from 'lodash';
import base32 from 'thirty-two';
import randomstring from 'randomstring';
import jsonwebtoken from 'jsonwebtoken';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import type { SignOptions } from './jwt-passport.js';
import type { User } from '../../balena-model.js';
import { randomBytesAsync } from '../../lib/utils.js';
import { getUser } from './auth.js';
import {
	JSON_WEB_TOKEN_EXPIRY_MINUTES,
	JSON_WEB_TOKEN_SECRET,
	JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH,
} from '../../lib/config.js';

const { InternalRequestError } = errors;
const { api } = sbvrUtils;

const SUDO_TOKEN_VALIDITY = 20 * 60 * 1000;

export const checkSudoValidity = (user: TokenUserPayload): boolean => {
	const notAuthBefore = Date.now() - SUDO_TOKEN_VALIDITY;
	return user.authTime != null && user.authTime > notAuthBefore;
};

export const generateNewJwtSecret = async (): Promise<string> => {
	// Generate a new secret and save it, to invalidate sessions using the old secret.
	// Length is a multiple of 20 to encode without padding.
	const key = await randomBytesAsync(20);
	return base32.encode(key).toString();
};

export const tokenFields = ['id', 'jwt_secret'] satisfies Array<
	keyof User['Read']
>;
// The content of the JWT that we give to users, other than the standard JWT props (eg iat,exp,...).
export interface TokenUserPayload extends Pick<
	User['Read'],
	(typeof tokenFields)[number]
> {
	twoFactorRequired?: boolean;
	authTime?: number;
}

const jwtValidFields = [
	...tokenFields,
	'authTime',
	'twoFactorRequired',
	'iat',
	'exp',
] satisfies Array<keyof TokenUserPayload | 'iat' | 'exp'>;

export interface ExtraParams {
	existingToken?: Partial<TokenUserPayload>;
	jwtOptions?: SignOptions;
	tx: Tx;
}

export type GetUserTokenDataFn = (
	userId: number,
	existingToken: Partial<TokenUserPayload> | undefined,
	tx: Tx,
) => PromiseLike<AnyObject>;

export function setUserTokenDataCallback(fn: GetUserTokenDataFn) {
	$getUserTokenDataCallback = fn;
}

let $getUserTokenDataCallback: GetUserTokenDataFn = async (
	userId,
	existingToken,
	tx: Tx,
): Promise<TokenUserPayload> => {
	const userData = await api.resin.get({
		resource: 'user',
		id: userId,
		passthrough: { req: permissions.root, tx },
		options: {
			$select: tokenFields,
		},
	});
	if (!userData) {
		throw new Error('No data found?!');
	}
	const newTokenData = _.pick(userData, tokenFields);

	const tokenData: TokenUserPayload = {
		// The existingToken that we pass in is the augmented object that
		// the jwt-passport returns, so we need to make sure we are not
		// destructuring extra properties.
		..._.pick(existingToken, jwtValidFields),
		...newTokenData,
	};

	if (!Number.isFinite(tokenData.authTime)) {
		tokenData.authTime = Date.now();
	}

	// skip nullish attributes
	return _.omitBy(tokenData, _.isNil) as TokenUserPayload;
};

export const createSessionToken = async (
	userId: number,
	{ existingToken, jwtOptions, tx }: ExtraParams,
): Promise<string> => {
	const tokenData = await $getUserTokenDataCallback(userId, existingToken, tx);
	return createJwt(tokenData, jwtOptions);
};

const sendXHRToken = (
	res: Response,
	token: string,
	tx: Tx,
	statusCode = 200,
) => {
	const $sendXHRToken = () => {
		res.header('content-type', 'text/plain');
		res.status(statusCode).send(token);
	};

	// Make sure to only send the response *after* the provided
	// transaction has been committed, to avoid race conditions
	// and be sure that the data did get persisted to the DB.
	tx.on('end', $sendXHRToken);
};

export const loginUserXHR = async (
	res: Response,
	userId: number,
	extraParams: ExtraParams & { statusCode?: number },
): Promise<void> => {
	const token = await createSessionToken(userId, extraParams);
	sendXHRToken(res, token, extraParams.tx, extraParams.statusCode);
};

export const updateUserXHR = async (
	res: Response,
	req: Request,
	{ tx }: { tx: Tx },
): Promise<void> => {
	await getUser(req, tx, false);
	if (req.creds == null || !('id' in req.creds) || req.creds.id == null) {
		throw new InternalRequestError('No user present');
	}
	const token = await createSessionToken(req.creds.id, {
		existingToken: req.creds,
		tx,
	});
	sendXHRToken(res, token, tx);
};

export interface ScopedAccessToken {
	access: ScopedToken;
}

export interface ScopedAccessTokenOptions {
	// The actor of the resulting token
	actor: number;
	// A list of permissions
	permissions: string[];
	// expires in x seconds
	expiresIn: number;
}

export interface ScopedToken extends sbvrUtils.Actor {
	actor: number;
	permissions: string[];
}

export function createScopedAccessToken(
	options: ScopedAccessTokenOptions,
): string {
	const payload: ScopedAccessToken = {
		access: {
			actor: options.actor,
			permissions: options.permissions,
		},
	};

	const signOptions: jsonwebtoken.SignOptions = {
		expiresIn: options.expiresIn,
		jwtid: randomstring.generate(),
	};

	return createJwt(payload, signOptions);
}

const EXPIRY_SECONDS = JSON_WEB_TOKEN_EXPIRY_MINUTES * 60;
// if the new jwt should be created from an existing one,
// the expiration date of the existing token is taken over
// If a new token is issued the input value or default is used.
export const createJwt = (
	payload: AnyObject,
	jwtOptions: jsonwebtoken.SignOptions = {},
): string => {
	if (JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH === true) {
		if (payload.exp == null) {
			jwtOptions.expiresIn ??= EXPIRY_SECONDS;
		} else {
			// jsonwebtoken will throw an error if the expiresIn and exp are both set.
			// So we need to delete the expiresIn to tke over the old expiration date.
			delete jwtOptions.expiresIn;
		}
	} else {
		jwtOptions.expiresIn ??= EXPIRY_SECONDS;
		delete payload.exp;
	}
	delete payload.iat;
	return jsonwebtoken.sign(payload, JSON_WEB_TOKEN_SECRET, jwtOptions);
};
