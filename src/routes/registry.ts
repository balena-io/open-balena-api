// Implements the server part of: https://docs.docker.com/registry/spec/auth/token/
// Reference: https://docs.docker.com/registry/spec/auth/jwt/

import * as _ from 'lodash';
import * as uuid from 'node-uuid';
import * as BasicAuth from 'basic-auth';
import * as jsonwebtoken from 'jsonwebtoken';
import { resinApi, root, sbvrUtils } from '../platform';
import * as Bluebird from 'bluebird';

import { User as DbUser } from '../models';
import { captureException, handleHttpErrors } from '../platform/errors';
import { retrieveAPIKey } from '../platform/api-keys';

import { registryAuth as CERT } from '../lib/certs';
import { RequestHandler, Request } from 'express';
import {
	AUTH_RESINOS_REGISTRY_CODE,
	TOKEN_AUTH_BUILDER_TOKEN,
	REGISTRY2_HOST,
} from '../lib/config';
import { Resolvable } from '@resin/pinejs/out/sbvr-api/common-types';
import * as memoize from 'memoizee';

const { UnauthorizedError } = sbvrUtils;

// Set a large expiry so that huge pulls/pushes go through
// without needing to re-authenticate mid-process.
const TOKEN_EXPIRY_MINUTES = 240; // 4 hours

const RESINOS_REPOSITORY = 'resin/resinos';
const SUPERVISOR_REPOSITORIES = /^resin\/(?:[a-zA-Z0-9]+-)+supervisor$/;

const NEW_REGISTRY_REGEX = /(^(\d+)\/[\d\-]+$|^(v2\/[a-z0-9]+)(-[0-9]+)?)/;

// This regex parses a scope of the form
//		repository:<image>:<permissions>
//	where <image> can be
//		<appname>/<commit>
//		<appID>/<buildId>
//		v2/<hash>
//		resin/resinos (and related "standard" image names)
//
//		with an optional tag or content digest on each kind
//	where <permissions> can be a comma separated list of permissions, e.g.
//		pull
//		push
//		push,pull
const SCOPE_PARSE_REGEX = /^([a-z]+):([a-z0-9_-]+\/[a-z0-9_-]+|\d+\/[\d\-]+|v2\/[a-z0-9]+-[0-9]+)(?::[a-z0-9]+|@sha256:[a-f0-9]+)?:((?:push|pull|,)+)$/;

export interface Access {
	name: string;
	type: string;
	actions: string[];
}
type Scope = [Access['type'], Access['name'], Access['actions']];

// Resolves permissions and populates req.user object, in case an api key is used
// in the password field of a basic authentication header
export const basicApiKeyAuthenticate: RequestHandler = (req, _res, next) => {
	const creds = BasicAuth.parse(req.headers['authorization']!);
	if (creds) {
		req.params.subject = creds.name;
		req.params.apikey = creds.pass;
	}
	return retrieveAPIKey(req).asCallback(next);
};

const parseScope = (req: Request, scope: string): Scope | undefined => {
	try {
		if (!scope) {
			return;
		}

		const params = scope.match(SCOPE_PARSE_REGEX);

		if (params == null) {
			return;
		}

		if (params[1] !== 'repository') {
			return;
		}

		return [params[1], params[2], params[3].split(',')];
	} catch (err) {
		captureException(err, `Failed to parse scope '${scope}'`, { req });
	}
	return;
};

const grantAllToBuilder = (parsedScopes: Scope[]): Access[] =>
	parsedScopes.map(scope => {
		const [type, name, requestedActions] = scope;
		let allowedActions = ['pull', 'push'];
		if (name === RESINOS_REPOSITORY) {
			allowedActions = ['pull'];
		}
		if (SUPERVISOR_REPOSITORIES.test(name)) {
			allowedActions = ['pull'];
		}
		return {
			type,
			name,
			actions: _.intersection(requestedActions, allowedActions),
		};
	});

const resolveReadAccess = (_req: Request, image?: AnyObject): boolean =>
	image != null && image.id != null;

const resolveWriteAccess = async (
	req: Request,
	image?: AnyObject,
): Promise<boolean> => {
	if (image == null || image.id == null) {
		return false;
	}
	try {
		const res = (await resinApi.post({
			url: `image(${image.id})/canAccess`,
			passthrough: { req },
			body: { action: 'push' },
		})) as AnyObject;
		return res.d != null && res.d[0] != null && res.d[0].id === image.id;
	} catch (err) {
		if (!(err instanceof UnauthorizedError)) {
			captureException(err, 'Failed to resolve registry write access', {
				req,
			});
		}
		return false;
	}
};

const resolveAccess = async (
	req: Request,
	type: string,
	name: string,
	effectiveName: string,
	requestedActions: string[],
	defaultActions: string[] = [],
): Promise<Access> => {
	let allowedActions;
	// Do as few queries as possible
	const needsPull =
		requestedActions.includes('pull') && !defaultActions.includes('pull');
	const needsPush =
		requestedActions.includes('push') && !defaultActions.includes('push');
	if (!needsPush && !needsPull) {
		allowedActions = defaultActions;
	} else {
		try {
			const [image] = (await resinApi.get({
				resource: 'image',
				passthrough: { req },
				options: {
					$select: ['id'],
					$filter: {
						is_stored_at__image_location: {
							$endswith: effectiveName,
						},
					},
				},
			})) as AnyObject[];

			const hasReadAccess = needsPull && resolveReadAccess(req, image);
			const hasWriteAccess =
				(await needsPush) && (await resolveWriteAccess(req, image));

			const actions = _.clone(defaultActions);
			if (hasReadAccess) {
				actions.push('pull');
			}
			if (hasWriteAccess) {
				actions.push('push');
			}
			allowedActions = actions;
		} catch (err) {
			if (!(err instanceof UnauthorizedError)) {
				captureException(err, 'Failed to resolve registry access', { req });
			}
			allowedActions = defaultActions;
		}
	}

	return {
		name,
		type,
		actions: _.intersection(requestedActions, allowedActions),
	};
};

const authorizeRequest = (
	req: Request,
	scopes: string[],
): Resolvable<Access[]> => {
	const parsedScopes: Scope[] = _(scopes)
		.map(scope => parseScope(req, scope))
		.compact()
		.value();

	if (req.params['apikey'] === TOKEN_AUTH_BUILDER_TOKEN) {
		return grantAllToBuilder(parsedScopes);
	}

	return Bluebird.map(parsedScopes, ([type, name, requestedActions]) => {
		if (name === RESINOS_REPOSITORY) {
			let allowedActions = ['pull'];
			if (
				AUTH_RESINOS_REGISTRY_CODE != null &&
				req.params['apikey'] === AUTH_RESINOS_REGISTRY_CODE
			) {
				allowedActions = ['pull', 'push'];
			}
			return {
				type,
				name,
				actions: _.intersection(requestedActions, allowedActions),
			};
		} else if (SUPERVISOR_REPOSITORIES.test(name)) {
			let allowedActions = ['pull'];
			if (
				AUTH_RESINOS_REGISTRY_CODE != null &&
				req.params['apikey'] === AUTH_RESINOS_REGISTRY_CODE
			) {
				allowedActions = ['pull', 'push'];
			}
			return {
				type,
				name,
				actions: _.intersection(requestedActions, allowedActions),
			};
		} else {
			const match = name.match(NEW_REGISTRY_REGEX);
			if (match != null) {
				// request for new-style, authenticated v2/randomhash image
				let effectiveName = name;
				if (match[4] != null) {
					// This is a multistage image, use the root image name
					effectiveName = match[3];
				}
				return resolveAccess(req, type, name, effectiveName, requestedActions);
			} else {
				// request for legacy public-read appName/commit image
				return resolveAccess(req, type, name, name, requestedActions, ['pull']);
			}
		}
	});
};

const generateToken = (
	subject: string = '',
	audience: string,
	access: Access[],
): string => {
	const payload = {
		jti: uuid.v4(),
		nbf: Math.floor(Date.now() / 1000) - 10,
		access,
	};
	const options = {
		algorithm: CERT.algo,
		issuer: CERT.issuer,
		audience,
		subject,
		expiresIn: 60 * TOKEN_EXPIRY_MINUTES,
		header: {
			kid: CERT.kid,
		},
	};
	return jsonwebtoken.sign(payload, CERT.key, options);
};

export const token: RequestHandler = async (req, res) => {
	try {
		const { scope } = req.query;
		let scopes: string[];
		if (_.isString(scope)) {
			scopes = [scope];
		} else if (_.isArray(scope)) {
			scopes = scope;
		} else if (_.isObject(scope)) {
			scopes = _.values(scope);
		} else {
			scopes = [];
		}

		const [sub, access] = await Promise.all([
			getSubject(req),
			authorizeRequest(req, scopes),
		]);
		res.send({
			token: generateToken(sub, REGISTRY2_HOST, access),
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.sendStatus(400); // bad request
	}
};

const $getSubject = memoize(
	async (apiKey: string, subject?: string): Promise<string | undefined> => {
		if (subject) {
			try {
				// Try to resolve as a device api key first, using the passed in subject
				const [device] = (await resinApi.get({
					resource: 'device',
					passthrough: { req: root },
					options: {
						$select: ['id'],
						$filter: {
							// uuids are passed as `d_${uuid}`
							uuid: subject.replace(/^d_/, ''),
							actor: {
								$any: {
									$alias: 'a',
									$expr: {
										a: {
											api_key: {
												$any: {
													$alias: 'k',
													$expr: { k: { key: apiKey } },
												},
											},
										},
									},
								},
							},
						},
					},
				})) as AnyObject[];
				if (device != null && device.id != null) {
					return subject;
				}
			} catch {}
		}
		// If resolving as a device api key fails then instead try to resolve to the user api key username
		const [user] = (await resinApi.get({
			resource: 'user',
			passthrough: { req: root },
			options: {
				$select: 'username',
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
												k: { key: apiKey },
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
		})) as [Pick<DbUser, 'username'>?];
		if (user) {
			return user.username;
		}
	},
	{
		promise: true,
		maxAge: 5 * 60 * 1000,
		primitive: true,
	},
);
const getSubject = (req: Request): Resolvable<undefined | string> => {
	if (req.apiKey != null && !_.isEmpty(req.apiKey.permissions)) {
		return $getSubject(req.apiKey.key, req.params.subject);
	} else if (req.user) {
		// If there's no api key then try to use the username from the JWT
		return req.user.username;
	}
};
