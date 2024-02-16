import { hooks, permissions } from '@balena/pinejs';
import { getApplicationSlug } from '../index.js';
import type { Application, Organization } from '../../../balena-model.js';

hooks.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: ({ request }) => {
		// Make sure the slug is included in the PATCH and fetch/set the true value in the POSTRUN
		// where we will definitely have the db transaction available
		request.values.slug ??= '';
	},
	PRERUN: async ({ request, api }) => {
		if (request.values.organization != null) {
			const organization = (await api.get({
				resource: 'organization',
				id: request.values.organization,
				options: {
					$select: 'handle',
				},
			})) as Pick<Organization, 'handle'> | undefined;
			if (organization) {
				request.values.slug = getApplicationSlug(
					organization.handle,
					request.values.app_name,
				);
			}
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTRUN: async ({ request, api, tx }) => {
		const ids = request.affectedIds!;
		if (ids.length === 0) {
			return;
		}
		if (
			request.values.organization != null ||
			request.values.app_name != null
		) {
			// If the owner of the app or the application name is changed, then update
			// the app's `slug`.

			// We do the actual update as root because it's a system
			// generated field and cannot be modified directly by the user
			const rootApi = api.clone({
				passthrough: { tx, req: permissions.root },
			});

			const apps = await rootApi.get({
				resource: 'application',
				options: {
					$select: ['id', 'app_name'],
					$expand: {
						organization: {
							$select: ['handle'],
						},
					},
					$filter: {
						id: { $in: ids },
					},
				},
			});

			await Promise.all(
				apps.map((app) =>
					rootApi.patch({
						resource: 'application',
						id: app.id,
						body: {
							slug: getApplicationSlug(
								app.organization[0].handle,
								app.app_name,
							),
						},
					}),
				),
			);
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'organization', {
	POSTRUN: async ({ request, api, tx }) => {
		const orgIds = request.affectedIds!;
		if (orgIds.length === 0) {
			return;
		}

		if (request.values.handle != null) {
			await Promise.all(
				orgIds.map(async (organizationID) => {
					const apps = (await api.get({
						resource: 'application',
						options: {
							$filter: {
								organization: organizationID,
							},
							$select: ['id', 'app_name'],
						},
					})) as Array<Pick<Application, 'id' | 'app_name'>>;

					const rootApiTx = api.clone({
						passthrough: {
							req: permissions.root,
							tx,
						},
					});

					await Promise.all(
						apps.map(({ id, app_name }) =>
							rootApiTx.patch({
								resource: 'application',
								id,
								body: {
									slug: getApplicationSlug(request.values.handle, app_name),
								},
							}),
						),
					);
				}),
			);
		}
	},
});
