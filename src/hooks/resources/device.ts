import * as _ from 'lodash';

import { sbvrUtils, hooks, permissions, errors } from '@balena/pinejs';

import { checkDevicesCanHaveDeviceURL } from '../../features/application-types/application-types';

const { BadRequestError } = errors;

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { api, request } = args;
		const waitPromises: Array<PromiseLike<any>> = [];

		// check the release is valid for the devices affected...
		if (request.values.should_be_running__release != null) {
			waitPromises.push(
				sbvrUtils.getAffectedIds(args).then(async (deviceIds) => {
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
						throw new BadRequestError('Release is not valid for this device');
					}
				}),
			);
		}

		if (request.values.is_web_accessible) {
			const rootApi = api.clone({
				passthrough: {
					req: permissions.root,
				},
			});
			waitPromises.push(
				sbvrUtils
					.getAffectedIds(args)
					.then((deviceIds) =>
						checkDevicesCanHaveDeviceURL(rootApi, deviceIds),
					),
			);
		}

		await Promise.all(waitPromises);
	},
});
