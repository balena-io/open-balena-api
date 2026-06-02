import jsonwebtoken from 'jsonwebtoken';
import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { TypedError } from 'typed-error';

import { permissions, sbvrUtils } from '@balena/pinejs';

import { JSON_WEB_TOKEN_SECRET } from '../../lib/config.js';

import { captureException } from '../error-handling/index.js';
import type {
	ScopedAccessToken,
	ScopedRolesToken,
	ScopedToken,
	TokenUserPayload,
} from './jwt.js';
import type { User } from '../../balena-model.js';
import type { PickDeferred } from '@balena/abstract-sql-to-typescript';
import { getGuestActorId, getRolePermissions } from './permissions.js';
import { createUnvalidatedRequestHandler } from '../validation/index.js';

export type { SignOptions } from 'jsonwebtoken';

const { api } = sbvrUtils;

class InvalidJwtSecretError extends TypedError {}

export interface ServiceToken extends sbvrUtils.Actor {
	service: string;
	apikey: string;
	permissions: string[];
}

export interface ApiKey extends sbvrUtils.ApiKey {
	key: string;
}

// What pine expects on Creds after a JWT is parsed so that everything works.
export type ResolvedUserPayload = TokenUserPayload & sbvrUtils.User;

// What decoded content of Passport finds on the Authorization header
type UnparsedCreds =
	| ServiceToken
	| TokenUserPayload
	| ScopedAccessToken
	| ScopedRolesToken;
// The result after JwtStrategy runs
export type Creds = ServiceToken | ResolvedUserPayload | ScopedToken;
const TOKEN_BODY_FIELD = '_token';

const jwtFromRequest = ExtractJwt.versionOneCompatibility({
	tokenBodyField: TOKEN_BODY_FIELD,
	authScheme: 'Bearer',
});

function verifyJwtAndFetchUser(
	id: Pick<User['Read'], 'id'>,
	jwtSecret: string | null,
): Promise<PickDeferred<User['Read'], 'actor'>>;
function verifyJwtAndFetchUser(
	id: Pick<User['Write'], 'actor'>,
	jwtSecret: string | null,
): Promise<PickDeferred<User['Read'], 'id'>>;
async function verifyJwtAndFetchUser(
	id: Pick<User['Read'], 'id'> | Pick<User['Write'], 'actor'>,
	jwtSecret: string | null,
) {
	const user = await api.resin.get({
		resource: 'user',
		id,
		passthrough: { req: permissions.rootRead },
		options: {
			$select: 'actor' in id ? 'id' : 'actor',
			$filter: { jwt_secret: jwtSecret },
		},
	});
	if (user == null) {
		throw new InvalidJwtSecretError();
	}
	return user;
}

const processVerifiedJwtPayload = async (
	jwtUser: UnparsedCreds,
): Promise<Creds> => {
	if (jwtUser == null) {
		throw new InvalidJwtSecretError();
	}
	if ('service' in jwtUser && jwtUser.service) {
		const { service, apikey } = jwtUser;
		const apiKeyPermissions = await permissions.getApiKeyPermissions(apikey);
		return { service, apikey, permissions: apiKeyPermissions };
	} else if ('roles' in jwtUser && jwtUser.roles != null) {
		const { actor } = jwtUser;
		if ('jwt_secret' in jwtUser && jwtUser.jwt_secret != null) {
			await verifyJwtAndFetchUser({ actor: jwtUser.actor }, jwtUser.jwt_secret);
		}

		return {
			actor,
			permissions: await getRolePermissions(jwtUser.roles),
			extraBinds: jwtUser.bindings,
		};
	} else if (
		'access' in jwtUser &&
		jwtUser.access?.actor &&
		jwtUser.access?.permissions
	) {
		return jwtUser.access;
	} else if ('id' in jwtUser) {
		const user = await verifyJwtAndFetchUser(
			{ id: jwtUser.id },
			jwtUser.jwt_secret ?? null,
		);
		const userPermissions = await permissions.getUserPermissions(jwtUser.id);
		const processedJwtUser = jwtUser as ResolvedUserPayload;
		processedJwtUser.actor = user.actor.__id;
		processedJwtUser.permissions = userPermissions;
		return processedJwtUser;
	} else {
		throw new Error('Invalid JWT');
	}
};

export const verifyAndResolveJwt = async (token: string): Promise<Creds> => {
	const decoded = jsonwebtoken.verify(
		token,
		JSON_WEB_TOKEN_SECRET,
	) as UnparsedCreds;
	return await processVerifiedJwtPayload(decoded);
};

export const createStrategy = () =>
	new JwtStrategy(
		{
			secretOrKey: JSON_WEB_TOKEN_SECRET,
			jwtFromRequest,
		},
		async (jwtUser: UnparsedCreds, done) => {
			try {
				const result = await processVerifiedJwtPayload(jwtUser);
				done(null, result);
			} catch (e) {
				done(e);
			}
		},
	);

export const middleware = createUnvalidatedRequestHandler((req, res, next) => {
	const jwtString = jwtFromRequest(req);
	if (!jwtString || typeof jwtString !== 'string' || !jwtString.includes('.')) {
		// If we don't have any possibility of a valid jwt string then we avoid
		// attempting authentication with it altogether
		next();
		return;
	}

	const authenticate = passport.authenticate(
		'jwt',
		{ session: false },
		async (err: Error, auth: Creds) => {
			// Clear the body token field in case it exists to avoid any
			// possible leaking
			// store the potential body token in the authorziation header
			// so that it can be used later on as well
			if (req.body != null && typeof req.body === 'object') {
				const possibleToken = req.body[TOKEN_BODY_FIELD];
				delete req.body[TOKEN_BODY_FIELD];
				if (possibleToken && !req.headers.authorization) {
					req.headers.authorization = `Bearer ${possibleToken}`;
				}
			}

			if (err instanceof InvalidJwtSecretError) {
				return res.status(401).end();
			}
			if (err) {
				captureException(err, 'Error JWT auth');
				next(err);
				return;
			}
			if (!auth) {
				next();
				return;
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
				req.user = auth as ResolvedUserPayload & {
					twoFactorRequired: false;
				};
			}
			next();
		},
	);
	authenticate(req, res, next);
});

export const isJWT = (token: string): boolean => !!jsonwebtoken.decode(token);
