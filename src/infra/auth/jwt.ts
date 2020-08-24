import type { Request, Response } from 'express';

import * as _ from 'lodash';
import * as base32 from 'thirty-two';
import * as randomstring from 'randomstring';
import * as jsonwebtoken from 'jsonwebtoken';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import { SignOptions, User } from './jwt-passport';

import { pseudoRandomBytesAsync } from '../../lib/utils';
import { getUser, userFields } from './auth';
import {
	JSON_WEB_TOKEN_EXPIRY_MINUTES,
	JSON_WEB_TOKEN_SECRET,
} from '../../lib/config';

const { InternalRequestError } = errors;
const { api } = sbvrUtils;

const SUDO_TOKEN_VALIDITY = 20 * 60 * 1000;

export const checkSudoValidity = async (user: User): Promise<boolean> => {
	const notAuthBefore = Date.now() - SUDO_TOKEN_VALIDITY;
	return user.authTime != null && user.authTime > notAuthBefore;
};

export const generateNewJwtSecret = async (): Promise<string> => {
	// Generate a new secret and save it, to invalidate sessions using the old secret.
	// Length is a multiple of 20 to encode without padding.
	const key = await pseudoRandomBytesAsync(20);
	return base32.encode(key).toString();
};

export const tokenFields = [...userFields];

export interface ExtraParams {
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
			passthrough: { req: permissions.root },
			options: {
				$select: tokenFields,
			},
		}) as Promise<AnyObject>,
		permissions.getUserPermissions(userId),
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

	if (!Number.isFinite(tokenData.authTime!)) {
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
export const createJwt = (
	payload: AnyObject,
	jwtOptions: jsonwebtoken.SignOptions = {},
): string => {
	_.defaults(jwtOptions, { expiresIn: EXPIRY_SECONDS });
	delete payload.iat;
	delete payload.exp;
	return jsonwebtoken.sign(payload, JSON_WEB_TOKEN_SECRET, jwtOptions);
};
