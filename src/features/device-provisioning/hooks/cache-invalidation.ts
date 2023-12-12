import { sbvrUtils, permissions, hooks } from '@balena/pinejs';
import { checkApiKeyExistsStore } from '../gracefully-deny-conflicting-registrations';
import { checkDeviceExistsIsFrozen } from '../../device-state/middleware';
import { captureException } from '../../../infra/error-handling';

const setupCacheInvalidation = <K extends string>(
	model: string,
	resource: string,
	keyProperty: K,
	cache: { delete: (key: string) => Promise<void> },
) => {
	hooks.addPureHook('DELETE', model, resource, {
		PRERUN: async (args) => {
			const { api, tx } = args;
			const affectedIds = await sbvrUtils.getAffectedIds(args);
			if (affectedIds.length === 0) {
				return;
			}
			const affectedItems = (await api.get({
				resource,
				passthrough: { req: permissions.root, tx },
				options: {
					$select: keyProperty,
					$filter: {
						id: { $in: affectedIds },
					},
				},
			})) as Array<{ [key in K]: string }>;

			// Invalidate the caches only when the tx is committed
			tx.on('end', () => {
				for (const affectedItem of affectedItems) {
					// Run in the background as this is not a reason to fail the request
					// eslint-disable-next-line @typescript-eslint/no-floating-promises
					(async () => {
						try {
							await cache.delete(affectedItem[keyProperty]);
						} catch (err) {
							captureException(
								err,
								`Error while invalidating a(n) ${model} record from the device registration gracefully deny cache: ${affectedIds}`,
							);
						}
					})();
				}
			});
		},
	});
};

setupCacheInvalidation('resin', 'device', 'uuid', checkDeviceExistsIsFrozen);
setupCacheInvalidation('resin', 'api_key', 'key', checkApiKeyExistsStore);
setupCacheInvalidation('Auth', 'api_key', 'key', checkApiKeyExistsStore);
