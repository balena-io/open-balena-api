import type { Request } from 'express';
import randomstring from 'randomstring';
import _ from 'lodash';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';
import { multiCacheMemoizee } from '../../infra/cache/index.js';
import { API_KEY_ROLE_CACHE_TIMEOUT } from '../../lib/config.js';
import { checkSudoValidity } from '../../infra/auth/jwt.js';
import { getUser } from '../../infra/auth/auth.js';

const { api } = sbvrUtils;
const { BadRequestError } = errors;

export interface ApiKeyOptions {
	apiKey?: string;
	name: string | null;
	description: string | null;
	expiryDate: string | null;
	tx?: Tx;
}

interface InternalApiKeyOptions extends ApiKeyOptions {
	apiKey: string;
	tx: Tx;
}

type ApiKeyActor = 'application' | 'device' | 'user';

const $createApiKey = async (
	actorType: ApiKeyActor,
	roleName: string,
	req: Request,
	actorTypeID: number,
	{ apiKey, tx, name, description, expiryDate }: InternalApiKeyOptions,
): Promise<string> => {
	const actorable = await api.resin.get({
		resource: actorType,
		id: actorTypeID,
		passthrough: { req, tx },
		options: {
			$select: 'actor',
		},
	});

	const actorID = actorable?.actor.__id;
	if (actorID == null) {
		throw new Error(`No ${actorType} found to associate with the api key`);
	}

	const res = await api.resin.request({
		method: 'POST',
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

	if (actorType === 'user' && !checkSudoValidity(await getUser(req, tx))) {
		throw new errors.UnauthorizedError('Fresh authentication token required');
	}

	const authApiTx = api.Auth.clone({
		passthrough: {
			tx,
			req: permissions.root,
		},
	});

	const [{ id: apiKeyId }, role] = await Promise.all([
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
		}),
		authApiTx.get({
			resource: 'role',
			id: {
				name: roleName,
			},
			options: {
				$select: 'id',
			},
		}),
	]);

	if (role == null) {
		throw new errors.NotFoundError(`Role '${roleName}' not found`);
	}

	await authApiTx.post({
		resource: 'api_key__has__role',
		body: {
			api_key: apiKeyId,
			role: role.id,
		},
		options: { returnResource: false },
	});

	return apiKey;
};

function validateFieldProp<U>(
	field: unknown,
	mandatory: boolean,
	fn: (field: unknown) => field is U,
): field is U | null {
	if (mandatory) {
		// it is mandatory for users to provide the property in the request
		// but null is a valid value.
		return field === null || fn(field);
	}
	return field == null || fn(field);
}
export function getApiKeyOptsFromRequest(
	params: Dictionary<unknown>,
	prefix?: string,
	mandatoryExpiryDate?: false,
): Pick<ApiKeyOptions, 'name' | 'description' | 'expiryDate'>;
export function getApiKeyOptsFromRequest(
	params: Dictionary<unknown>,
	prefix: string | undefined,
	mandatoryExpiryDate: true,
): NonNullableField<
	Pick<ApiKeyOptions, 'name' | 'description' | 'expiryDate'>,
	'expiryDate'
>;
export function getApiKeyOptsFromRequest(
	params: Dictionary<unknown>,
	prefix?: string,
	mandatoryExpiryDate?: boolean,
): Pick<ApiKeyOptions, 'name' | 'description' | 'expiryDate'>;
export function getApiKeyOptsFromRequest(
	params: Dictionary<unknown>,
	prefix?: string,
	mandatoryExpiryDate = false,
): Pick<ApiKeyOptions, 'name' | 'description' | 'expiryDate'> {
	const name = params[prefix ? `${prefix}Name` : 'name'];
	const description = params[prefix ? `${prefix}Description` : 'description'];
	const expiryDate = params[prefix ? `${prefix}ExpiryDate` : 'expiryDate'];

	if (name != null && typeof name !== 'string') {
		throw new errors.BadRequestError('Key name should be a string value');
	}

	if (description != null && typeof description !== 'string') {
		throw new errors.BadRequestError(
			'Key description should be a string value',
		);
	}

	if (
		!validateFieldProp(
			expiryDate,
			mandatoryExpiryDate,
			(f): f is string =>
				typeof f === 'string' && !isNaN(new Date(f).getTime()),
		)
	) {
		throw new errors.BadRequestError('Key expiry date should be a valid date');
	}

	return {
		name: name ?? null,
		description: description ?? null,
		expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
	};
}

export const createApiKey = async (
	actorType: ApiKeyActor,
	roleName: string,
	req: Request,
	actorTypeID: number,
	options: ApiKeyOptions,
): Promise<string> => {
	const { name, description, expiryDate } = getApiKeyOptsFromRequest(req.body);
	const create = async (tx: Tx) => {
		return await $createApiKey(actorType, roleName, req, actorTypeID, {
			...options,
			apiKey: options.apiKey ?? randomstring.generate(),
			name: options.name ?? name,
			description: options.description ?? description,
			expiryDate: options.expiryDate ?? expiryDate,
			tx,
		});
	};

	if (options.tx != null) {
		return await create(options.tx);
	} else {
		return await sbvrUtils.db.transaction(async (tx) => await create(tx));
	}
};

export const createProvisioningApiKey = _.partial(
	createApiKey,
	'application',
	'provisioning-api-key',
);
export const createDeviceApiKey = _.partial(
	createApiKey,
	'device',
	'device-api-key',
);
export const createNamedUserApiKey = _.partial(
	createApiKey,
	'user',
	'named-user-api-key',
);

/**
 * @deprecated this is a legacy api key for very old devices and should not be used any more
 */
export const createUserApiKey = _.partial(createApiKey, 'user', 'user-api-key');

export type ApiKeyParameters = {
	actorType: (typeof supportedActorTypes)[number];
	actorTypeId: number;
	roles: string[];
} & Pick<ApiKeyOptions, 'name' | 'description' | 'expiryDate' | 'apiKey'>;

export const supportedActorTypes = ['application', 'user', 'device'] as const;

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

	if (roles.length !== 1) {
		throw new BadRequestError('API Keys currently only support a single role');
	}
	const roleName = roles[0];

	if (name === '') {
		name = null;
	}
	if (name == null) {
		const namedRole = roles.find((r) => r.startsWith('named-'));

		if (namedRole != null) {
			throw new BadRequestError(
				`API keys with the '${namedRole}' role require a name`,
			);
		}
	}

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
		api.Auth.prepare(
			{
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
			} as const,
			{ key: ['string'], roleName: ['string'] },
		),
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
		{ useVersion: false },
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
	extraPermissions: string[],
	/**
	 * When mutateRequestObject is
	 * false: A new request object with augmented permissions is returned to be used for specific tasks,
	 *   while the rest of the code (eg: middleware & hooks) still runs with permissions the original request.
	 * true: The permissions are augmented for the whole lifetime of the request.
	 */
	mutateRequestObject = false,
): T => {
	let augmentedReq = req;

	if (!mutateRequestObject) {
		augmentedReq = _.clone(req);
		augmentedReq.apiKey = _.cloneDeep(augmentedReq.apiKey);
	} else if (augmentedReq.apiKey?.permissions) {
		// When mutateRequestObject === true we still need to clone
		// the permissions array rather than modifying it directly
		// so that we do not pollute pine's apiKeyPermissions cache.
		augmentedReq.apiKey.permissions = [...augmentedReq.apiKey.permissions];
	}

	augmentedReq.apiKey?.permissions?.push(...extraPermissions);
	return augmentedReq;
};
