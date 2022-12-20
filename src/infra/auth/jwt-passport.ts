import Bluebird from 'bluebird';
import type { RequestHandler } from 'express';
import jsonwebtoken from 'jsonwebtoken';
import _ from 'lodash';
import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { TypedError } from 'typed-error';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { JSON_WEB_TOKEN_SECRET } from '../../lib/config';

import { captureException } from '../error-handling';
import { ScopedAccessToken, ScopedToken } from './jwt';
import { PickDeferred, User as DbUser } from '../../balena-model';
import { getGuestActorId } from './permissions';

export { SignOptions } from 'jsonwebtoken';

class InvalidJwtSecretError extends TypedError {}

export interface ServiceToken extends sbvrUtils.Actor {
	service: string;
	apikey: string;
	permissions: string[];
}

export interface ApiKey extends sbvrUtils.ApiKey {
	key: string;
}

export interface User extends sbvrUtils.User {
	username: string;
	email: string | null;
	created_at: string;
	jwt_secret: string | null;

	twoFactorRequired?: boolean;
	authTime?: number;
}

export type Creds = ServiceToken | User | ScopedToken;
export type JwtUser = Creds | ScopedAccessToken;
const TOKEN_BODY_FIELD = '_token';

const jwtFromRequest = ExtractJwt.versionOneCompatibility({
	tokenBodyField: TOKEN_BODY_FIELD,
	authScheme: 'Bearer',
});

export const createStrategy = (
	fetchUser: (
		id: number,
	) => Promise<PickDeferred<DbUser, 'jwt_secret' | 'actor'>>,
) =>
	new JwtStrategy(
		{
			secretOrKey: JSON_WEB_TOKEN_SECRET,
			jwtFromRequest,
		},
		(jwtUser: JwtUser, done) =>
			Bluebird.try(async (): Promise<Creds> => {
				if (jwtUser == null) {
					throw new InvalidJwtSecretError();
				}
				if ('service' in jwtUser && jwtUser.service) {
					const { service, apikey } = jwtUser;
					const apiKeyPermissions = await permissions.getApiKeyPermissions(
						apikey,
					);
					return { service, apikey, permissions: apiKeyPermissions };
				} else if (
					'access' in jwtUser &&
					jwtUser.access != null &&
					jwtUser.access.actor &&
					jwtUser.access.permissions
				) {
					return jwtUser.access;
				} else if ('id' in jwtUser) {
					const user = await fetchUser(jwtUser.id);
					if (user == null) {
						throw new InvalidJwtSecretError();
					}

					// Default both to null so that we don't hit issues with null !== undefined
					const userSecret = user.jwt_secret ?? null;
					const jwtSecret = jwtUser.jwt_secret ?? null;

					if (userSecret !== jwtSecret) {
						throw new InvalidJwtSecretError();
					}

					jwtUser.actor = user.actor.__id;
					const userPermissions = await permissions.getUserPermissions(
						jwtUser.id,
					);

					jwtUser.permissions = userPermissions;
					return jwtUser;
				} else {
					throw new Error('Invalid JWT');
				}
			}).nodeify(done),
	);

export const middleware: RequestHandler = (req, res, next) => {
	const jwtString = jwtFromRequest(req);
	if (!jwtString || typeof jwtString !== 'string' || !jwtString.includes('.')) {
		// If we don't have any possibility of a valid jwt string then we avoid
		// attempting authentication with it altogether
		return next();
	}

	const authenticate = passport.authenticate(
		'jwt',
		{ session: false },
		async (err: Error, auth: Creds) => {
			// Clear the body token field in case it exists to avoid any
			// possible leaking
			// store the potential body token in the authorziation header
			// so that it can be used later on as well
			const possibleToken = req.body[TOKEN_BODY_FIELD];
			delete req.body[TOKEN_BODY_FIELD];
			if (possibleToken && !req.headers.authorization) {
				req.headers.authorization = `Bearer ${possibleToken}`;
			}

			if (err instanceof InvalidJwtSecretError) {
				return res.status(401).end();
			}
			if (err) {
				captureException(err, 'Error JWT auth', { req });
				return next(err);
			}
			if (!auth) {
				return next();
			}

			req.creds = auth;
			if ('service' in auth && auth.service) {
				// setting req.apiKey allows service JWT tokens to be used with odata requests
				req.apiKey = {
					key: auth.apikey,
					// Warning: This requires/assumes all service api keys are created under the guest actor
					actor: await getGuestActorId(),
					permissions: auth.permissions,
				};
			} else if ('twoFactorRequired' in auth && auth.twoFactorRequired) {
				// We cast twoFactorRequired as true because we just checked it
				req.partialUser = auth as typeof auth & {
					twoFactorRequired: true;
				};
			} else {
				req.user = auth as User & {
					twoFactorRequired: false;
				};
			}
			next();
		},
	);
	authenticate(req, res, next);
};

export const isJWT = (token: string): boolean => !!jsonwebtoken.decode(token);
