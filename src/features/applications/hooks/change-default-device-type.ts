import { sbvrUtils, hooks, errors } from '@balena/pinejs';

hooks.addPureHook('PATCH', 'resin', 'application', {
	PRERUN: async (args) => {
		const { request, api } = args;
		if (request.values.is_for__device_type == null) {
			return;
		}

		const appIds = await sbvrUtils.getAffectedIds(args);
		if (appIds.length === 0) {
			return;
		}

		const currentAndTargetCpuArchCount = await api.get({
			resource: 'cpu_architecture',
			options: {
				$count: {
					$filter: {
						is_supported_by__device_type: {
							$any: {
								$alias: 'dt',
								$expr: {
									$or: [
										{
											dt: {
												id: request.values.is_for__device_type,
											},
										},
										{
											dt: {
												is_default_for__application: {
													$any: {
														$alias: 'a',
														$expr: {
															a: {
																id: {
																	$in: appIds,
																},
															},
														},
													},
												},
											},
										},
									],
								},
							},
						},
					},
				},
			},
		});

		// When we get back only a single cpu arch,
		// then the current DT of all apps & the target DT are of the same arch.
		if (currentAndTargetCpuArchCount > 1) {
			throw new errors.BadRequestError(
				'The new default device type should be of the same cpu architecture as the previous one.',
			);
		}
	},
});
