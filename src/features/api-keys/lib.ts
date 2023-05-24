import type { Request } from 'express';
import randomstring from 'randomstring';
import _ from 'lodash';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import { Deferred, Application, Device, Role, User } from '../../balena-model';
import { multiCacheMemoizee } from '../../infra/cache';
import { API_KEY_ROLE_CACHE_TIMEOUT } from '../../lib/config';

const { api } = sbvrUtils;
const { BadRequestError } = errors;

export interface ApiKeyOptions {
	apiKey?: string;
	name?: string;
	description?: string;
	expiryDate?: string;
	tx?: Tx;
}

interface InternalApiKeyOptions extends ApiKeyOptions {
	apiKey: string;
	tx: Tx;
}

const $createApiKey = async (
	actorType: string,
	roleName: string,
	req: Request,
	actorTypeID: number,
	{ apiKey, tx, name, description, expiryDate }: InternalApiKeyOptions,
): Promise<string> => {
	const actorable = (await api.resin.get({
		resource: actorType,
		id: actorTypeID,
		passthrough: { req, tx },
		options: {
			$select: 'actor',
		},
	})) as
		| {
				actor: Deferred<Application['actor'] | Device['actor'] | User['actor']>;
		  }
		| undefined;

	const actorID = actorable?.actor.__id;
	if (actorID == null) {
		throw new Error(`No ${actorType} found to associate with the api key`);
	}

	const res = await api.resin.post({
		url: `${actorType}(${actorTypeID})/canAccess`,
		passthrough: { req, tx },
		body: {
			action: `create-${roleName}`,
		},
	});

	const resId: number | undefined = res?.d?.[0]?.id;
	if (resId !== actorTypeID) {
		throw new errors.ForbiddenError();
	}

	const authApiTx = api.Auth.clone({
		passthrough: {
			tx,
			req: permissions.root,
		},
	});

	const [{ id: apiKeyId }, { id: roleId }] = await Promise.all([
		authApiTx.post({
			resource: 'api_key',
			body: {
				is_of__actor: actorID,
				key: apiKey,
				name,
				description,
				expiry_date: expiryDate,
			},
			options: { returnResource: false },
		}) as Promise<{ id: number }>,
		authApiTx.get({
			resource: 'role',
			id: {
				name: roleName,
			},
			options: {
				$select: 'id',
			},
		}) as Promise<Pick<Role, 'id'>>,
	]);

	await authApiTx.post({
		resource: 'api_key__has__role',
		body: {
			api_key: apiKeyId,
			role: roleId,
		},
		options: { returnResource: false },
	});

	return apiKey;
};

const getKeyMetadata = (reqBody: {
	name?: any;
	description?: any;
	expiryDate?: any;
}) => {
	const { name, description, expiryDate } = reqBody;

	if (name != null && typeof name !== 'string') {
		throw new errors.BadRequestError('Key name should be a string value');
	}

	if (description != null && typeof description !== 'string') {
		throw new errors.BadRequestError(
			'Key description should be a string value',
		);
	}

	if (
		expiryDate != null &&
		(typeof expiryDate !== 'string' || isNaN(new Date(expiryDate).getTime()))
	) {
		throw new errors.BadRequestError('Key expiry date should be a valid date');
	}

	return {
		name,
		description,
		...(expiryDate && {
			expiryDate: new Date(expiryDate),
		}),
	};
};

export const createApiKey = async (
	actorType: string,
	roleName: string,
	req: Request,
	actorTypeID: number,
	options: ApiKeyOptions = {},
): Promise<string> => {
	options.apiKey ??= randomstring.generate();
	const { name, description, expiryDate } = getKeyMetadata(req.body);

	if (!options.name) {
		options.name = name;
	}
	if (!options.description) {
		options.description = description;
	}
	if (!options.expiryDate) {
		options.expiryDate = expiryDate;
	}

	if (options.tx != null) {
		return await $createApiKey(
			actorType,
			roleName,
			req,
			actorTypeID,
			options as InternalApiKeyOptions,
		);
	} else {
		return await sbvrUtils.db.transaction(async (tx) => {
			options.tx = tx;
			return await $createApiKey(
				actorType,
				roleName,
				req,
				actorTypeID,
				options as InternalApiKeyOptions,
			);
		});
	}
};

export type PartialCreateKey = (
	req: Request,
	actorTypeID: number,
	options?: ApiKeyOptions,
) => Promise<string>;

export const createProvisioningApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'application',
	'provisioning-api-key',
);
export const createDeviceApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'device',
	'device-api-key',
);
export const createNamedUserApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'user',
	'named-user-api-key',
);

/**
 * @deprecated this is a legacy api key for very old devices and should not be used any more
 */
export const createUserApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'user',
	'user-api-key',
);

export type ApiKeyParameters = {
	actorType: (typeof supportedActorTypes)[number];
	actorTypeId: number;
	roles: string[];
} & Pick<ApiKeyOptions, 'name' | 'description' | 'expiryDate' | 'apiKey'>;

const supportedActorTypes = ['application', 'user', 'device'] as const;

export const createGenericApiKey = async (
	req: Request,
	{
		actorType,
		actorTypeId,
		roles,
		name,
		description,
		expiryDate,
		apiKey,
	}: ApiKeyParameters,
) => {
	if (!supportedActorTypes.includes(actorType)) {
		throw new BadRequestError('Unsupported actor type');
	}

	if (!Number.isFinite(actorTypeId)) {
		throw new BadRequestError('Actor type id must be a number');
	}

	if (
		!Array.isArray(roles) ||
		roles.length === 0 ||
		roles.some((r) => typeof r !== 'string' || r.length === 0)
	) {
		throw new BadRequestError('Roles should be an array of role names');
	}

	if (roles.length !== 1) {
		throw new BadRequestError('API Keys currently only support a single role');
	}

	if (!name) {
		const namedRole = roles.find((r) => r.startsWith('named-'));

		if (namedRole != null) {
			throw new BadRequestError(
				`API keys with the '${namedRole}' role require a name`,
			);
		}
	}

	const roleName = roles[0];

	return createApiKey(
		actorType,
		roleName,
		req,
		actorTypeId,
		// pass only the properties that the endpoint supports
		{
			name,
			description,
			expiryDate,
			apiKey,
		},
	);
};

export const isApiKeyWithRole = (() => {
	const authQuery = _.once(() =>
		api.Auth.prepare<{ key: string; roleName: string }>({
			resource: 'role',
			passthrough: { req: permissions.root },
			id: {
				name: { '@': 'roleName' },
			},
			options: {
				$select: 'id',
				$filter: {
					is_of__api_key: {
						$any: {
							$alias: 'khr',
							$expr: {
								khr: {
									api_key: {
										$any: {
											$alias: 'k',
											$expr: {
												k: {
													key: { '@': 'key' },
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		}),
	);
	return multiCacheMemoizee(
		async (key: string, roleName: string, tx?: Tx): Promise<boolean> => {
			const role = await authQuery()({ key, roleName }, undefined, {
				tx,
			});
			return role != null;
		},
		{
			cacheKey: 'isApiKeyWithRole',
			promise: true,
			primitive: true,
			maxAge: API_KEY_ROLE_CACHE_TIMEOUT,
			normalizer: ([key, roleName]) => `${roleName}$${key}`,
		},
	);
})();

/**
 * Temporarily augments the request's api key with the specified permissions.
 * This will not have any effect if the request is not using an api key
 */
export const augmentReqApiKeyPermissions = <
	T extends permissions.PermissionReq,
>(
	req: T,
	...extraPermissions: string[]
): T => {
	const augmentedReq = _.clone(req);
	augmentedReq.apiKey = _.cloneDeep(augmentedReq.apiKey);
	augmentedReq.apiKey?.permissions?.push(...extraPermissions);
	return augmentedReq;
};
