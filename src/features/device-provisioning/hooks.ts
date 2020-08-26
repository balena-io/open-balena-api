import { hooks, errors } from '@balena/pinejs';

/**
 * TODO-MULTI-APP: this hooks should move into /device/register
 */
hooks.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: async ({ request }) => {
		if (request.values.belongs_to__application == null) {
			throw new errors.BadRequestError();
		}
	},
	POSTRUN: async ({ req, request, api, result: deviceId }) => {
		if (deviceId == null) {
			return;
		}
		if (request.values.belongs_to__application != null) {
			if (req.apiKey?.permissions != null) {
				// Add the permission to assign the created device to the current application for application/provisioning keys, will have no effect for device/user keys
				req.apiKey.permissions.push(
					`resin.device__belongs_to__application.create?device eq ${deviceId} and belongs_to__application/any(a:a/actor eq @__ACTOR_ID)`,
					`resin.application.read?actor eq @__ACTOR_ID`,
				);
			}
			await api.post({
				resource: 'device_application',
				passthrough: {
					custom: {
						deviceRegister: {
							uuid: request.values.uuid,
							deviceType: request.values.device_type,
						},
					},
				},
				body: {
					device: deviceId,
					belongs_to__application: request.values.belongs_to__application,
				},
			});
		}
	},
});
