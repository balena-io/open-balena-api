import * as Bluebird from 'bluebird';
import * as _ from 'lodash';

import { sbvrUtils } from '@resin/pinejs';

import {
	addDeleteHookForDependents,
	createActor,
	getCurrentRequestAffectedIds,
} from '../../platform';
import { captureException } from '../../platform/errors';

import { Default as DefaultApplicationType } from '../../lib/application-types';
import { postDevices } from '../../lib/device-proxy';
import { resolveDeviceType } from '../common';

const { BadRequestError, ConflictError, NotFoundError, root } = sbvrUtils;

const checkDependentApplication: sbvrUtils.Hooks['POSTPARSE'] = async ({
	request,
	api,
}) => {
	const dependsOnApplicationId = request.values.belongs_to__application;
	if (dependsOnApplicationId != null) {
		const dependsOnApplication = await api.get({
			resource: 'application',
			id: dependsOnApplicationId,
			options: {
				$select: ['id'],
			},
		});
		if (dependsOnApplication == null) {
			throw new BadRequestError('Invalid application to depend upon');
		}
	}
};

sbvrUtils.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: createActor,
});

sbvrUtils.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: async (args) => {
		const { req, request, api } = args;
		const appName = request.values.app_name;

		if (request.values.application_type == null) {
			request.values.application_type = DefaultApplicationType.id;
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
			throw new BadRequestError('App name may only contain [a-zA-Z0-9_-].');
		}

		try {
			await Bluebird.all([
				resolveDeviceType(api, request, 'is_for__device_type'),
				checkDependentApplication(args),
			]);
			request.values.should_track_latest_release = true;
			if (request.values.slug == null) {
				request.values.slug = appName.toLowerCase();
			}
		} catch (err) {
			if (!(err instanceof ConflictError)) {
				captureException(err, 'Error in application postparse hook', { req });
			}
			throw err;
		}
	},
});

sbvrUtils.addPureHook('PUT', 'resin', 'application', {
	POSTPARSE: checkDependentApplication,
});

sbvrUtils.addPureHook('PATCH', 'resin', 'application', {
	PRERUN: (args) => {
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
				getCurrentRequestAffectedIds(args).then((ids) => {
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

		return Bluebird.all(waitPromises);
	},
	POSTRUN: async ({ request }) => {
		if (request.values.should_be_running__release != null) {
			// Only update apps if they have had their release changed.
			const ids = (await request.custom.affectedIds) as number[];
			if (ids.length === 0) {
				return;
			}
			return postDevices({
				url: '/v1/update',
				req: root,
				filter: {
					belongs_to__application: { $in: ids },
					is_running__release: {
						$ne: request.values.should_be_running__release,
					},
					should_be_running__release: null,
				},
				// Don't wait for the posts to complete, as they may take a long time and we've already sent the prompt to update.
				wait: false,
			});
		}
	},
});

sbvrUtils.addPureHook('DELETE', 'resin', 'application', {
	PRERUN: async (args) => {
		const appIds = await getCurrentRequestAffectedIds(args);
		if (appIds.length === 0) {
			const { odataQuery } = args.request;
			if (odataQuery != null && odataQuery.key != null) {
				// If there's a specific app targeted we make sure we give a 404 for backwards compatibility
				throw new NotFoundError('Application(s) not found.');
			}
			return;
		}
		// find devices which are
		// not part of any of the applications that are about to be deleted
		// but run a release that belongs to any of the applications that
		// is about to be deleted
		const devices = (await args.api.get({
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
		})) as AnyObject[];
		if (devices.length !== 0) {
			const uuids = devices.map(({ uuid }) => uuid);
			throw new BadRequestError('updateRequired', {
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

addDeleteHookForDependents('application', [
	['device', 'belongs_to__application'],
	['application_config_variable', 'application'],
	['application_environment_variable', 'application'],
	['application_tag', 'application'],
	['release', 'belongs_to__application'],
	['service', 'application'],
	['application', 'depends_on__application'],
]);
