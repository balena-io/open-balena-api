// Implements the server part of: https://docs.docker.com/registry/spec/auth/token/
// Reference: https://docs.docker.com/registry/spec/auth/jwt/

import * as _ from 'lodash';
import * as uuid from 'node-uuid';
import * as BasicAuth from 'basic-auth';
import * as jsonwebtoken from 'jsonwebtoken';
import { resinApi, root, sbvrUtils, PinejsClient } from '../platform';
import * as Promise from 'bluebird';

import { captureException, handleHttpErrors } from '../platform/errors';
import { retrieveAPIKey } from '../platform/api-keys';
import { getUser } from '../platform/auth';

import { registryAuth as CERT } from '../lib/certs';
import { RequestHandler, Request } from 'express';
import {
	AUTH_RESINOS_REGISTRY_CODE,
	TOKEN_AUTH_BUILDER_TOKEN,
	REGISTRY2_HOST,
} from '../lib/config';

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

interface Access {
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
		req.params['apikey'] = creds.pass;
	}
	return retrieveAPIKey(req)
		.then(() => {
			if (!creds || req.apiKey == null || _.isEmpty(req.apiKey.permissions)) {
				return;
			}
			const rootApi = resinApi.clone({ passthrough: { req: root } });
			return checkApiKeyBelongsToDevice(
				rootApi,
				creds.pass,
				creds.name.replace(/^d_/, ''),
			).then(isValid => {
				if (!isValid) {
					return;
				}
				req.subject = creds.name;
			});
		})
		.asCallback(next);
};

const checkApiKeyBelongsToDevice = (
	api: PinejsClient,
	apiKey: string,
	uuid: string,
): Promise<boolean> =>
	api
		.get({
			resource: 'device',
			options: {
				$select: ['id'],
				$filter: {
					uuid,
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
		})
		.then(([device]: AnyObject[]) => device != null && device.id != null)
		.catchReturn(false);

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

const grantAllToBuilder = (parsedScopes: Scope[]): Promise<Access[]> =>
	Promise.try(() =>
		_.map(parsedScopes, scope => {
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
		}),
	);

const resolveReadAccess = (_req: Request, image?: AnyObject): boolean =>
	image != null && image.id != null;

const resolveWriteAccess = (
	req: Request,
	image?: AnyObject,
): Promise<boolean> => {
	if (image == null || image.id == null) {
		return Promise.resolve(false);
	}
	return resinApi
		.post({
			url: `image(${image.id})/canAccess`,
			passthrough: { req },
			body: { action: 'push' },
		})
		.then(
			(res: AnyObject) =>
				res.d != null && res.d[0] != null && res.d[0].id === image.id,
		)
		.catch(err => {
			if (!(err instanceof UnauthorizedError)) {
				captureException(err, 'Failed to resolve registry write access', {
					req,
				});
			}
			return false;
		});
};

const resolveAccess = (
	req: Request,
	type: string,
	name: string,
	effectiveName: string,
	requestedActions: string[],
	defaultActions: string[] = [],
): Promise<Access> => {
	return Promise.try(() => {
		// Do as few queries as possible
		const needsPull =
			requestedActions.includes('pull') && !defaultActions.includes('pull');
		const needsPush =
			requestedActions.includes('push') && !defaultActions.includes('push');
		if (!needsPush && !needsPull) {
			return defaultActions;
		}

		return resinApi
			.get({
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
			})
			.then(([image]: AnyObject[]) =>
				Promise.join(
					needsPull && resolveReadAccess(req, image),
					needsPush && resolveWriteAccess(req, image),
					(hasReadAccess, hasWriteAccess) => {
						const actions = _.clone(defaultActions);
						if (hasReadAccess) {
							actions.push('pull');
						}
						if (hasWriteAccess) {
							actions.push('push');
						}
						return actions;
					},
				),
			);
	})
		.catch(err => {
			if (!(err instanceof UnauthorizedError)) {
				captureException(err, 'Failed to resolve registry access', { req });
			}
			return defaultActions;
		})
		.then(allowedActions => {
			return {
				name,
				type,
				actions: _.intersection(requestedActions, allowedActions),
			};
		});
};

const authorizeRequest = (
	req: Request,
	scopes: string[],
): Promise<Access[]> => {
	const parsedScopes: Scope[] = _(scopes)
		.map(scope => parseScope(req, scope))
		.compact()
		.value();

	if (req.params['apikey'] === TOKEN_AUTH_BUILDER_TOKEN) {
		return grantAllToBuilder(parsedScopes);
	}

	return Promise.map(parsedScopes, ([type, name, requestedActions]) => {
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

export const token: RequestHandler = (req, res) => {
	const scopes = _.castArray(req.query.scope);

	return Promise.join(
		getSubject(req),
		authorizeRequest(req, scopes),
		(sub, access) => {
			const token = generateToken(sub, REGISTRY2_HOST, access);
			res.send({ token });
		},
	).catch(err => {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.sendStatus(400); // bad request
	});
};

const getSubject = Promise.method((req: Request) => {
	if (req.subject) {
		return req.subject;
	}

	return getUser(req, false).then(
		user => (user == null ? undefined : user.username),
	);
});
