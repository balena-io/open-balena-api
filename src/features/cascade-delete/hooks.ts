import { sbvrUtils, hooks, permissions, errors } from '@balena/pinejs';
import { captureException } from '../../infra/error-handling/index.js';
import { setupDeleteCascade } from './setup-delete-cascade.js';

const { api, getAffectedIds } = sbvrUtils;

// TODO: These should end up grouped into the features that declare the relationship existence

setupDeleteCascade('application', {
	device: 'belongs_to__application',
	application_config_variable: 'application',
	application_environment_variable: 'application',
	application_tag: 'application',
	release: 'belongs_to__application',
	service: 'application',
});

setupDeleteCascade('device', {
	device_config_variable: 'device',
	device_environment_variable: 'device',
	device_service_environment_variable: 'device',
	device_tag: 'device',
	image_install: 'device',
	service_install: 'device',
});

setupDeleteCascade('image', {
	image_install: 'installs__image',
	image__is_part_of__release: 'image',
});

setupDeleteCascade('image__is_part_of__release', {
	image_label: 'release_image',
	image_environment_variable: 'release_image',
});

setupDeleteCascade('release', {
	release_asset: 'release',
	release_tag: 'release',
	image__is_part_of__release: 'is_part_of__release',
	image_install: 'is_provided_by__release',
});

setupDeleteCascade('service', {
	device_service_environment_variable: 'service',
	service_environment_variable: 'service',
	service_install: 'installs__service',
	image: 'is_a_build_of__service',
	service_label: 'service',
});

const deleteApiKeyHooks: hooks.Hooks = {
	PRERUN: async (args) => {
		const keyIds = await getAffectedIds(args);
		if (keyIds.length === 0) {
			return;
		}

		await Promise.all(
			(['api_key__has__role', 'api_key__has__permission'] as const).map(
				async (resource) => {
					try {
						await api.Auth.delete({
							resource,
							passthrough: {
								tx: args.tx,
								req: permissions.root,
							},
							options: {
								$filter: { api_key: { $in: keyIds } },
							},
						});
					} catch (err) {
						captureException(err, 'Error deleting api key ' + resource, {
							req: args.req,
						});
						throw err;
					}
				},
			),
		);
	},
};

hooks.addPureHook('DELETE', 'Auth', 'api_key', deleteApiKeyHooks);
hooks.addPureHook('DELETE', 'resin', 'api_key', deleteApiKeyHooks);

hooks.addPureHook('DELETE', 'resin', 'user', {
	PRERUN: async ({ req, request, tx, api: resinApi }) => {
		const { userId } = request.custom;

		const authApiTx = sbvrUtils.api.Auth.clone({
			passthrough: {
				tx,
				req: permissions.root,
			},
		});

		const authApiDeletes = Promise.all(
			(['user__has__role', 'user__has__permission'] as const).map(
				async (resource) => {
					try {
						await authApiTx.delete({
							resource,
							options: {
								$filter: {
									user: userId,
								},
							},
						});
					} catch (err) {
						captureException(err, `Error deleting user ${resource}`, { req });
						throw err;
					}
				},
			),
		);

		const apiKeyDelete = resinApi
			.get({
				resource: 'user',
				id: userId,
				options: {
					$select: 'actor',
				},
			})
			.then(async (user) => {
				if (user == null) {
					throw new errors.BadRequestError('Invalid user');
				}
				request.custom.actorId = user.actor.__id;
				try {
					await authApiTx.delete({
						resource: 'api_key',
						options: {
							$filter: {
								is_of__actor: user.actor.__id,
							},
						},
					});
				} catch (err) {
					captureException(err, 'Error deleting user api_key', { req });
					throw err;
				}
			});

		await Promise.all([authApiDeletes, apiKeyDelete]);
	},
});
