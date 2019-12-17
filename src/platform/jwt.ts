import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as jsonwebtoken from 'jsonwebtoken';
import * as randomstring from 'randomstring';
import * as passport from 'passport';
import { sbvrUtils } from '@resin/pinejs';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { TypedError } from 'typed-error';
import { User as DbUser } from '../models';
import { captureException } from './errors';
import { RequestHandler } from 'express';

export { SignOptions } from 'jsonwebtoken';

import {
	JSON_WEB_TOKEN_SECRET,
	JSON_WEB_TOKEN_EXPIRY_MINUTES,
} from '../lib/config';

const EXPIRY_SECONDS = JSON_WEB_TOKEN_EXPIRY_MINUTES * 60;

const { root, api } = sbvrUtils;

class InvalidJwtSecretError extends TypedError {}

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

export interface ServiceToken extends sbvrUtils.Actor {
	service: string;
	apikey: string;
	permissions: string[];
}

export interface ScopedToken extends sbvrUtils.Actor {
	actor: number;
	permissions: string[];
}

export interface ApiKey extends sbvrUtils.ApiKey {
	key: string;
}

export interface User extends sbvrUtils.User {
	id: number;
	actor: number;
	username: string;
	email: string;
	created_at: string;
	jwt_secret?: string;
	permissions: string[];

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

export const strategy = new JwtStrategy(
	{
		secretOrKey: JSON_WEB_TOKEN_SECRET,
		jwtFromRequest,
	},
	(jwtUser: JwtUser, done) =>
		Bluebird.try(
			async (): Promise<Creds> => {
				if (jwtUser == null) {
					throw new InvalidJwtSecretError();
				}
				if ('service' in jwtUser && jwtUser.service) {
					const { service, apikey } = jwtUser;
					const permissions = await sbvrUtils.getApiKeyPermissions(apikey);
					return { service, apikey, permissions };
				} else if (
					'access' in jwtUser &&
					jwtUser.access != null &&
					jwtUser.access.actor &&
					jwtUser.access != null &&
					jwtUser.access.permissions
				) {
					return jwtUser.access;
				} else if ('id' in jwtUser) {
					const user = (await api.resin.get({
						resource: 'user',
						id: jwtUser.id,
						passthrough: { req: root },
						options: {
							$select: ['actor', 'jwt_secret'],
						},
					})) as Pick<DbUser, 'actor' | 'jwt_secret'>;
					if (user == null) {
						throw new InvalidJwtSecretError();
					}

					// Default both to null so that we don't hit issues with null !== undefined
					const userSecret = user.jwt_secret != null ? user.jwt_secret : null;
					const jwtSecret =
						jwtUser.jwt_secret != null ? jwtUser.jwt_secret : null;

					if (userSecret !== jwtSecret) {
						throw new InvalidJwtSecretError();
					}

					jwtUser.actor = user.actor;
					const permissions = await sbvrUtils.getUserPermissions(jwtUser.id);

					jwtUser.permissions = permissions;
					return jwtUser;
				} else {
					throw new Error('Invalid JWT');
				}
			},
		).nodeify(done),
);

export const createJwt = (
	payload: AnyObject,
	jwtOptions: jsonwebtoken.SignOptions = {},
): string => {
	_.defaults(jwtOptions, { expiresIn: EXPIRY_SECONDS });
	delete payload.iat;
	delete payload.exp;
	return jsonwebtoken.sign(payload, JSON_WEB_TOKEN_SECRET, jwtOptions);
};

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
		(err: Error, auth: Creds) => {
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
				return res.sendStatus(401);
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
					permissions: auth.permissions,
				};
			} else if ('twoFactorRequired' in auth && auth.twoFactorRequired) {
				// We cast twoFactorRequired as true because we just checked it
				req.partialUser = auth as typeof auth & {
					twoFactorRequired: true;
				};
			} else {
				req.user = auth;
			}
			next();
		},
	);
	authenticate(req, res, next);
};

export const isJWT = (token: string): boolean => !!jsonwebtoken.decode(token);

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
