import * as _ from 'lodash';
import * as Promise from 'bluebird';

import { resolveDeviceType } from '../common';
import { postDevices } from '../../lib/device-proxy';
import { Default as DefaultApplicationType } from '../../lib/application-types';

import {
	sbvrUtils,
	root,
	createActor,
	getCurrentRequestAffectedIds,
	addDeleteHookForDependents,
} from '../../platform';
const { BadRequestError, ConflictError } = sbvrUtils;
import { captureException } from '../../platform/errors';

import { Hooks } from '@resin/pinejs/out/sbvr-api/sbvr-utils';
import { VPN_HOST, VPN_PORT } from '../../lib/config';

const checkDependentApplication: Hooks['POSTPARSE'] = ({ request, api }) => {
	const dependsOnApplicationId = request.values.belongs_to__application;
	if (dependsOnApplicationId != null) {
		api
			.get({
				resource: 'application',
				id: dependsOnApplicationId,
				options: {
					$select: ['id'],
				},
			})
			.then(dependsOnApplication => {
				if (dependsOnApplication == null) {
					throw new Error('Invalid application to depend upon');
				}
			});
	}
};

sbvrUtils.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: createActor,
});

sbvrUtils.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: args => {
		const { req, request, api } = args;
		const appName = request.values.app_name;

		if (request.values.application_type == null) {
			request.values.application_type = DefaultApplicationType.id;
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
			throw new Error('App name may only contain [a-zA-Z0-9_-].');
		}

		return Promise.all([
			resolveDeviceType(api, request, 'is_for__device_type'),
			checkDependentApplication(args),
		])
			.then(() => {
				request.values.VPN_host = VPN_HOST;
				request.values.VPN_port = VPN_PORT;
				request.values.should_track_latest_release = true;
				if (request.values.slug == null) {
					request.values.slug = appName.toLowerCase();
				}
			})
			.tapCatch(err => {
				if (!(err instanceof ConflictError)) {
					captureException(err, 'Error in application postparse hook', { req });
				}
			});
	},
});

sbvrUtils.addPureHook('PUT', 'resin', 'application', {
	POSTPARSE: checkDependentApplication,
});

sbvrUtils.addPureHook('PATCH', 'resin', 'application', {
	PRERUN: args => {
		const waitPromises = [checkDependentApplication(args)];
		const { request } = args;
		const appName = request.values.app_name;

		if (appName) {
			if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
				throw new BadRequestError('App name may only contain [a-zA-Z0-9_-].');
			}
			if (request.values.slug == null) {
				request.values.slug = appName.toLowerCase();
			}
			waitPromises.push(
				getCurrentRequestAffectedIds(args).then(ids => {
					if (ids.length === 0) {
						return;
					}
					if (ids.length > 1) {
						throw new ConflictError(
							'Cannot rename multiple applications to the same name, please specify just one.',
						);
					}
				}),
			);
		}

		if (request.values.should_be_running__release != null) {
			// Used to make sure we've fetched the affected ids for the POSTRUN hook
			waitPromises.push(getCurrentRequestAffectedIds(args));
		}

		return Promise.all(waitPromises);
	},
	POSTRUN: ({ request }) => {
		if (request.values.should_be_running__release != null) {
			// Only update apps if they have had their release changed.
			return request.custom.affectedIds.then((ids: number[]) => {
				if (ids.length === 0) {
					return;
				}
				return postDevices({
					url: '/v1/update',
					req: root,
					filter: {
						belongs_to__application: { $in: ids },
					},
					// Don't wait for the posts to complete, as they may take a long time and we've already sent the prompt to update.
					wait: false,
				});
			});
		}
	},
});

sbvrUtils.addPureHook('DELETE', 'resin', 'application', {
	PRERUN: args =>
		getCurrentRequestAffectedIds(args).then(appIds => {
			if (appIds.length === 0) {
				const { odataQuery } = args.request;
				if (odataQuery != null && odataQuery.key != null) {
					// If there's a specific app targeted we make sure we give a 404 for backwards compatibility
					throw new Error('Application(s) not found.');
				}
			}
			if (appIds.length > 0) {
				// find devices which are
				// not part of any of the applications that are about to be deleted
				// but run a release that belongs to any of the applications that
				// is about to be deleted
				return args.api
					.get({
						resource: 'device',
						passthrough: {
							req: root,
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
					})
					.then((devices: AnyObject[]) => {
						if (devices.length === 0) {
							return;
						}

						const uuids = devices.map(({ uuid }) => uuid);
						throw new BadRequestError('updateRequired', {
							error: 'updateRequired',
							message: `Can't delete application(s) ${_.join(
								appIds,
								', ',
							)} because following devices are still running releases that belong to these application(s): ${_.join(
								uuids,
								', ',
							)}`,
							appids: appIds,
							uuids,
						});
					})
					.then(() => {
						// We need to null `should_be_running__release` or otherwise we have a circular dependency and cannot delete either
						return args.api
							.patch({
								resource: 'application',
								options: {
									$filter: {
										id: { $in: appIds },
										should_be_running__release: { $ne: null },
									},
								},
								body: { should_be_running__release: null },
							})
							.return();
					});
			}
		}),
});

addDeleteHookForDependents('application', [
	['device', 'belongs_to__application'],
	['application_config_variable', 'application'],
	['application_environment_variable', 'application'],
	['application_tag', 'application'],
	['release', 'belongs_to__application'],
	['service', 'application'],
	['application', 'depends_on__application'],
]);
