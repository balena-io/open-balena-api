import _ from 'lodash';
import { sbvrUtils, errors, permissions } from '@balena/pinejs';
import { API_KEY_EXISTS_CACHE_TIMEOUT } from '../../lib/config';
import { createMultiLevelStore } from '../../infra/cache';
import { checkDeviceExistsIsFrozen } from '../device-state/middleware';

const { ConflictError } = errors;
const { api } = sbvrUtils;

const checkApiKeyExistsQuery = _.once(() =>
	api.resin.prepare<{ key: string }>({
		resource: 'api_key',
		passthrough: { req: permissions.root },
		id: {
			key: { '@': 'key' },
		},
		options: {
			$select: 'id',
		},
	}),
);

export const checkApiKeyExistsStore = createMultiLevelStore<boolean>(
	'checkApiKeyExists',
	{
		default: {
			// We only care to cache the api keys that already exist,
			// so that we throw a conflict error earlier.
			isCacheableValue: (value: any) => value === true,
			ttl: API_KEY_EXISTS_CACHE_TIMEOUT,
		},
		local: false,
	},
	false,
);

const checkApiKeyExists = async (key: string) => {
	return await checkApiKeyExistsStore.wrap(key, async () => {
		const apiKey = await checkApiKeyExistsQuery()({ key });
		return apiKey != null;
	});
};

/**
 * Early reject requests with already existing UUIDs/api keys to avoid
 * running the whole registration process and its rules.
 * TODO: Consider removing this once pine supports rule narrowing on multiple resources.
 */
export async function gracefullyDenyConflictingRegistrations(
	uuid: string,
	apiKey: string | undefined,
) {
	// Even though requests with conflicting device UUIDs are cheap (since they throw before the rules run),
	// we do have to check for the UUID so that a registration with conflicting UUID & Api key still throws
	// the same error as if this optimization did not exist.
	const device = await checkDeviceExistsIsFrozen(uuid);
	if (device != null) {
		// Should be matching the conflict error that Pine would throw
		// so that the optimization is transparent.
		throw new ConflictError('"uuid" must be unique.');
	}

	const existingApiKey = apiKey != null && (await checkApiKeyExists(apiKey));
	if (existingApiKey) {
		// Should be matching the conflict error that Pine would throw
		// so that the optimization is transparent.
		throw new ConflictError('"key" must be unique.');
	}
}
