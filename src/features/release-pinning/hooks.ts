import { sbvrUtils, hooks, errors } from '@balena/pinejs';

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { request } = args;
		// check the release is valid for the devices affected...
		if (request.values.should_be_running__release != null) {
			const deviceIds = await sbvrUtils.getAffectedIds(args);
			if (deviceIds.length === 0) {
				return;
			}
			const release = await args.api.get({
				resource: 'release',
				id: request.values.should_be_running__release,
				options: {
					$select: ['id'],
					$filter: {
						status: 'success',
						belongs_to__application: {
							$any: {
								$alias: 'a',
								$expr: {
									a: {
										owns__device: {
											$any: {
												$alias: 'd',
												$expr: {
													d: {
														id: { $in: deviceIds },
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
			});

			if (release == null) {
				throw new errors.BadRequestError(
					'Release is not valid for this device',
				);
			}
		}
	},
});
