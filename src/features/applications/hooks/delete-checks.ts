import { sbvrUtils, hooks, errors, permissions } from '@balena/pinejs';

hooks.addPureHook('DELETE', 'resin', 'application', {
	PRERUN: async (args) => {
		const appIds = await sbvrUtils.getAffectedIds(args);
		if (appIds.length === 0) {
			const { odataQuery } = args.request;
			if (odataQuery != null && odataQuery.key != null) {
				// If there's a specific app targeted we make sure we give a 404 for backwards compatibility
				throw new errors.NotFoundError('Application(s) not found.');
			}
			return;
		}
		// find devices which are
		// not part of any of the applications that are about to be deleted
		// but run a release that belongs to any of the applications that
		// is about to be deleted
		const devices = await args.api.get({
			resource: 'device',
			passthrough: {
				req: permissions.root,
			},
			options: {
				$select: ['uuid'],
				$filter: {
					$not: {
						device_application: {
							$any: {
								$alias: 'da',
								$expr: {
									da: {
										belongs_to__application: { $in: appIds },
									},
								},
							},
						},
					},
					is_running__release: {
						$any: {
							$alias: 'r',
							$expr: {
								r: {
									belongs_to__application: {
										$in: appIds,
									},
								},
							},
						},
					},
				},
			},
		});
		if (devices.length !== 0) {
			const uuids = devices.map(({ uuid }) => uuid);
			throw new errors.BadRequestError('updateRequired', {
				error: 'updateRequired',
				message: `Can't delete application(s) ${appIds.join(
					', ',
				)} because following devices are still running releases that belong to these application(s): ${uuids.join(
					', ',
				)}`,
				appids: appIds,
				uuids,
			});
		}
		// We need to null `should_be_running__release` or otherwise we have a circular dependency and cannot delete either
		await args.api.patch({
			resource: 'application',
			options: {
				$filter: {
					id: { $in: appIds },
					should_be_running__release: { $ne: null },
				},
			},
			body: { should_be_running__release: null },
		});
	},
});
