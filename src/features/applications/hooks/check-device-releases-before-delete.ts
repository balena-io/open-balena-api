import { sbvrUtils, hooks, errors, permissions } from '@balena/pinejs';

hooks.addPureHook('DELETE', 'resin', 'application', {
	PRERUN: async (args) => {
		const appIds = await sbvrUtils.getAffectedIds(args);
		if (appIds.length === 0) {
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
						belongs_to__application: {
							$in: appIds,
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
	},
});
