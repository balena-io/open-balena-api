// Implements the server part of: https://docs.docker.com/registry/spec/auth/token/
// Reference: https://docs.docker.com/registry/spec/auth/jwt/

import type { Request, RequestHandler } from 'express';
import jsonwebtoken from 'jsonwebtoken';
import _ from 'lodash';
import {
	multiCacheMemoizee,
	reqPermissionNormalizer,
} from '../../infra/cache/index.js';
import { randomUUID } from 'node:crypto';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
} from '../../infra/error-handling/index.js';

import { registryAuth as CERT } from './certs.js';
import {
	AUTH_RESINOS_REGISTRY_CODE,
	GET_SUBJECT_CACHE_TIMEOUT,
	REGISTRY_TOKEN_AUDIENCE,
	REGISTRY_TOKEN_EXPIRY_SECONDS,
	RESOLVE_IMAGE_ID_CACHE_TIMEOUT,
	RESOLVE_IMAGE_LOCATION_CACHE_TIMEOUT,
	RESOLVE_IMAGE_READ_ACCESS_CACHE_TIMEOUT,
	TOKEN_AUTH_BUILDER_TOKEN,
} from '../../lib/config.js';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

const RESINOS_REPOSITORY = 'resin/resinos';
const SUPERVISOR_REPOSITORIES = /^resin\/(?:[a-zA-Z0-9]+-)+supervisor$/;

// match v2/randomhash image
const NEW_REGISTRY_REGEX = /(^(\d+)\/[\d-]+$|^(v2\/[a-z0-9]+)(-[0-9]+)?)/;

/*
 * Group 1: application slug (org/app)
 * Group 2: org name
 * Group 3: app name
 * Optional:
 * - Group 4: semver or commit
 * - Group 5: service name
 */
const APP_RELEASE_REGEX =
	/^(([a-z0-9_-]+)\/([a-z0-9_-]+))(?:\/([a-z0-9_.-]+))?(?:\/([a-z0-9_-]+))?$/;

const TARGET_RELEASE_KEYWORDS = [`latest`, `current`, `default`, `pinned`];

// This regex parses a scope of the form
// 		repository:<image>:<permissions>
// 	where <image> can be
// 		<appname>/<commit>
// 		<org>/<app>/<semver|commit>/<service>
// 		<appID>/<buildId>
// 		v2/<hash>
// 		resin/resinos (and related "standard" image names)
//
// 		with an optional tag or content digest on each kind
// 	where <permissions> can be a comma separated list of permissions, e.g.
// 		pull
// 		push
// 		push,pull
const SCOPE_PARSE_REGEX =
	/^([a-z]+):([a-z0-9_-]+\/[a-z0-9_-]+(?:\/[a-z0-9_.-]+)?(?:\/[a-z0-9_-]+)?|\d+\/[\d-]+|v2\/[a-z0-9]+-[0-9]+)(?::[a-z0-9]+|@sha256:[a-f0-9]+)?:((?:push|pull|,)+)$/;

export interface Access {
	name: string;
	type: string;
	actions: string[];
	alias?: string;
}
type Scope = [Access['type'], Access['name'], Access['actions']];

const parseScope = (scope: string): Scope | undefined => {
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
		captureException(err, `Failed to parse scope '${scope}'`);
	}
	return;
};

const grantAllToBuilder = (parsedScopes: Scope[]): Access[] =>
	parsedScopes.map((scope) => {
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

const resolveReadAccess = (() => {
	const $resolveReadAccess = multiCacheMemoizee(
		async (
			imageId: number,
			req: permissions.PermissionReq,
			tx: Tx,
		): Promise<boolean> => {
			// This is a performance optimization impactful when using device API key permissions,
			// in which case emitting the OR checks for the public device access
			// in a nested subquery didn't perform as well.
			// TODO: Should be converted back to a simple GET to the image resource once
			// the performance of that query improves.
			const [applicationWithImage] = await api.resin.get({
				resource: 'application',
				passthrough: { req, tx },
				options: {
					$top: 1,
					$select: 'id',
					$filter: {
						owns__release: {
							$any: {
								$alias: 'r',
								$expr: {
									r: {
										release_image: {
											image: imageId,
										},
									},
								},
							},
						},
					},
				},
			});
			return applicationWithImage != null;
		},
		{
			cacheKey: 'resolveReadAccess',
			promise: true,
			primitive: true,
			maxAge: RESOLVE_IMAGE_READ_ACCESS_CACHE_TIMEOUT,
			normalizer: ([imageId, req]) => {
				return `${imageId}$${reqPermissionNormalizer(req)}`;
			},
		},
		{ useVersion: false },
	);
	return async (
		req: Request,
		imageId: number | undefined,
		tx: Tx,
	): Promise<boolean> => {
		if (imageId == null) {
			return false;
		}
		return await $resolveReadAccess(imageId, req, tx);
	};
})();

const resolveWriteAccess = async (
	req: Request,
	imageId: number | undefined,
	tx: Tx,
): Promise<boolean> => {
	if (imageId == null) {
		return false;
	}
	try {
		const res = await api.resin.request({
			method: 'POST',
			url: `image(${imageId})/canAccess`,
			passthrough: { req, tx },
			body: { action: 'push' },
		});
		return res.d?.[0]?.id === imageId;
	} catch (err) {
		if (!(err instanceof UnauthorizedError)) {
			captureException(err, 'Failed to resolve registry write access');
		}
		return false;
	}
};

const resolveImageId = multiCacheMemoizee(
	async (effectiveName: string, tx: Tx): Promise<number | undefined> => {
		const [image] = await api.resin.get({
			resource: 'image',
			passthrough: { req: permissions.root, tx },
			options: {
				$select: ['id'],
				$filter: {
					is_stored_at__image_location: {
						$endswith: effectiveName,
					},
				},
			},
		});
		return image?.id;
	},
	{
		cacheKey: 'resolveImageId',
		undefinedAs: false,
		promise: true,
		primitive: true,
		maxAge: RESOLVE_IMAGE_ID_CACHE_TIMEOUT,
		max: 500,
		normalizer: ([effectiveName]) => effectiveName,
	},
	{ useVersion: false },
);

const resolveImageLocation = multiCacheMemoizee(
	async (
		applicationSlug: string,
		releaseHashOrVersion: string | undefined,
		serviceName: string | undefined,
		req: permissions.PermissionReq,
		tx: Tx,
	): Promise<string | undefined> => {
		try {
			const [image] = await api.resin.get({
				resource: 'image',
				passthrough: { req, tx },
				options: {
					$top: 1,
					$select: 'is_stored_at__image_location',
					$filter: {
						release_image: {
							$any: {
								$alias: 'ri',
								$expr: {
									ri: {
										is_part_of__release: {
											$any: {
												$alias: 'ipor',
												$expr: {
													$eq: [
														// for now only return releases with one image (service)
														{ ipor: { release_image: { $count: {} } } },
														1,
													],
													ipor: {
														status: 'success',
														belongs_to__application: {
															$any: {
																$alias: 'bta',
																$expr: {
																	bta: {
																		slug: applicationSlug,
																	},
																},
															},
														},
														...(releaseHashOrVersion == null && {
															should_be_running_on__application: {
																$any: {
																	$alias: 'sbroa',
																	$expr: {
																		sbroa: {
																			slug: applicationSlug,
																		},
																	},
																},
															},
														}),
													},
													...(releaseHashOrVersion != null && {
														$or: [
															{ ipor: { commit: releaseHashOrVersion } },
															{
																// if there are multiple revisions of a final release
																// match the semver and sort by revision to return the latest
																ipor: {
																	semver: releaseHashOrVersion,
																	is_final: true,
																},
															},
															{
																// raw version can match draft releases (0.0.0-123456789)
																// or final releases with no revisions (0.0.0)
																ipor: {
																	raw_version: releaseHashOrVersion,
																	is_final: false,
																},
															},
														],
													}),
												},
											},
										},
									},
								},
							},
						},
						status: 'success',
						...(serviceName != null && {
							is_a_build_of__service: {
								$any: {
									$alias: 'iabos',
									$expr: {
										iabos: {
											service_name: serviceName,
										},
									},
								},
							},
						}),
					},
					$orderby: [
						{ 'release_image/is_part_of__release/revision': 'desc' },
						{ id: 'asc' },
					],
				},
			});
			return image?.is_stored_at__image_location;
		} catch {
			// Ignore errors
		}
	},
	{
		cacheKey: 'resolveImageLocation',
		undefinedAs: false,
		promise: true,
		primitive: true,
		maxAge: RESOLVE_IMAGE_LOCATION_CACHE_TIMEOUT,
		max: 500,
		normalizer: ([applicationSlug, releaseHashOrVersion, serviceName, req]) => {
			return `${applicationSlug}${releaseHashOrVersion}${serviceName}${reqPermissionNormalizer(
				req,
			)}`;
		},
	},
	{ useVersion: false },
);

const resolveAccess = async (
	req: Request,
	type: string,
	name: string,
	effectiveName: string,
	requestedActions: string[],
	defaultActions: string[] = [],
	alias: string | undefined,
	tx: Tx,
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
			const imageId = await resolveImageId(effectiveName, tx);
			const [hasReadAccess, hasWriteAccess] = await Promise.all([
				needsPull && resolveReadAccess(req, imageId, tx),
				needsPush && resolveWriteAccess(req, imageId, tx),
			]);

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
				captureException(err, 'Failed to resolve registry access');
			}
			allowedActions = defaultActions;
		}
	}

	return {
		name,
		type,
		actions: _.intersection(requestedActions, allowedActions),
		...(alias != null ? { alias } : {}),
	};
};

const authorizeRequest = async (
	req: Request,
	scopes: string[],
	tx: Tx,
): Promise<Access[]> => {
	const parsedScopes: Scope[] = _(scopes)
		.map((scope) => parseScope(scope))
		.compact()
		.value();

	if (req.params['apikey'] === TOKEN_AUTH_BUILDER_TOKEN) {
		return grantAllToBuilder(parsedScopes);
	}

	return await Promise.all(
		parsedScopes.map(async ([type, name, requestedActions]) => {
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
			}

			if (SUPERVISOR_REPOSITORIES.test(name)) {
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
			}

			let match = name.match(NEW_REGISTRY_REGEX);
			if (match != null) {
				// request for new-style, authenticated v2/randomhash image
				let effectiveName = name;
				if (match[4] != null) {
					// This is a multistage image, use the root image name
					effectiveName = match[3];
				}
				return await resolveAccess(
					req,
					type,
					name,
					effectiveName,
					requestedActions,
					undefined,
					undefined,
					tx,
				);
			}

			// match <org>/<app>/<semver|commit>/<service> where <semver|commit> and <service> are optional
			match = name.match(APP_RELEASE_REGEX);
			if (match != null && match.length > 3) {
				// request for read-only application (blocks) releases
				let alias;

				const applicationSlug = match[1];
				let semverOrCommit = match[4] || undefined;
				const serviceName = match[5];

				// For now remove support for releases with multiple services
				if (serviceName != null) {
					return {
						name,
						type,
						actions: [],
					};
				}

				// allow keywords like 'latest' and 'current' to return the target release for the application
				if (
					semverOrCommit != null &&
					TARGET_RELEASE_KEYWORDS.includes(semverOrCommit)
				) {
					semverOrCommit = undefined;
				}

				const imageLocation = await resolveImageLocation(
					applicationSlug,
					semverOrCommit,
					serviceName,
					req,
					tx,
				);

				if (imageLocation != null) {
					// set alias to the requested name, and use the real image location for the name
					alias = name;
					name = imageLocation.split('/').slice(1).join('/');

					// only allow pull
					const allowedActions = ['pull'];

					return await resolveAccess(
						req,
						type,
						name,
						name,
						_.intersection(requestedActions, allowedActions),
						['pull'],
						alias,
						tx,
					);
				} else {
					// avoid falling back to legacy format if a semver/commit was provided
					if (semverOrCommit != null) {
						return {
							name,
							type,
							actions: [],
						};
					}
				}
			}

			// Requests for <org>/<app> may also get here if it failed
			// to resolve to an image location above.
			// But that's okay because we wll be granting permissions to a repo that
			// doesn't exist, and we don't want to break the legacy <app>/<commit> format
			// in this PR.

			// request for legacy public-read appName/commit image
			return await resolveAccess(
				req,
				type,
				name,
				name,
				requestedActions,
				['pull'],
				undefined,
				tx,
			);
		}),
	);
};

export const generateToken = (
	subject = '',
	audience: string,
	access: Access[],
): string => {
	const payload = {
		jti: randomUUID(),
		nbf: Math.floor(Date.now() / 1000) - 10,
		access,
	};
	const options = {
		algorithm: CERT.algo,
		issuer: CERT.issuer,
		audience,
		subject,
		expiresIn: REGISTRY_TOKEN_EXPIRY_SECONDS,
		keyid: CERT.kid,
	};
	return jsonwebtoken.sign(payload, CERT.key, options);
};

export const token: RequestHandler = async (req, res) => {
	try {
		const { scope } = req.query;
		let scopes: string[];
		if (typeof scope === 'string') {
			scopes = [scope];
		} else if (Array.isArray(scope)) {
			scopes = scope as string[];
		} else if (_.isObject(scope)) {
			scopes = Object.values(scope) as string[];
		} else {
			scopes = [];
		}

		const [sub, access] = await sbvrUtils.db.readTransaction(
			async (tx) =>
				await Promise.all([
					getSubject(req, tx),
					authorizeRequest(req, scopes, tx),
				]),
		);
		res.json({
			token: generateToken(sub, REGISTRY_TOKEN_AUDIENCE, access),
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(400).end(); // bad request
	}
};

const $getSubject = multiCacheMemoizee(
	async (
		apiKey: string,
		subject: string | undefined,
		tx: Tx,
	): Promise<string | undefined> => {
		if (subject) {
			try {
				// Try to resolve as a device api key first, using the passed in subject
				const device = await api.resin.get({
					resource: 'device',
					passthrough: { req: permissions.root, tx },
					id: {
						// uuids are passed as `d_${uuid}`
						uuid: subject.replace(/^d_/, ''),
					},
					options: {
						$select: ['id'],
						$filter: {
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
				});
				if (device != null) {
					return subject;
				}
			} catch {
				// Ignore errors
			}
		}
		// If resolving as a device api key fails then instead try to resolve to the user api key username
		const [user] = await api.resin.get({
			resource: 'user',
			passthrough: { req: permissions.root },
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
		});
		if (user) {
			return user.username;
		}
	},
	{
		cacheKey: '$getSubject',
		undefinedAs: false,
		promise: true,
		maxAge: GET_SUBJECT_CACHE_TIMEOUT,
		primitive: true,
		normalizer: ([apiKey, subject]) => `${apiKey}\u0001${subject}`,
	},
	{ useVersion: false },
);
const getSubject = async (
	req: Request,
	tx: Tx,
): Promise<undefined | string> => {
	if (req.apiKey != null && !_.isEmpty(req.apiKey.permissions)) {
		return await $getSubject(req.apiKey.key, req.params.subject, tx);
	} else if (req.user && 'id' in req.user) {
		// If there's no api key then try to fetch the user from JWT credentials and get the username
		const user = await api.resin.get({
			resource: 'user',
			passthrough: { req, tx },
			id: req.user.id,
			options: {
				$select: 'username',
			},
		});
		return user?.username;
	}
};
