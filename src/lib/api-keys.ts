import type { Request } from 'express';
import * as _ from 'lodash';
import { errors } from '@balena/pinejs';
import {
	createApiKey,
	ApiKeyOptions,
	PartialCreateKey,
} from '../platform/api-keys';

const { BadRequestError } = errors;

const supportedActorTypes = ['application', 'user', 'device'] as const;

export type ApiKeyParameters = {
	actorType: typeof supportedActorTypes[number];
	actorTypeId: number;
	roles: string[];
} & Pick<ApiKeyOptions, 'name' | 'description' | 'apiKey'>;

export const createGenericApiKey = async (
	req: Request,
	{
		actorType,
		actorTypeId,
		roles,
		name,
		description,
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
			apiKey,
		},
	);
};

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

// Deprecated
export const createUserApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'user',
	'user-api-key',
);
