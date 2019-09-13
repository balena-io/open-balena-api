import * as _ from 'lodash';
import { sbvrUtils, addDeleteHookForDependents } from '../../platform';
import { HookArgs } from '@resin/pinejs/out/sbvr-api/sbvr-utils';

const updateLatestRelease = (id: number, { request, api }: HookArgs) => {
	// We only track builds that are successful
	if (request.values.status === 'success') {
		return api
			.get({
				resource: 'release',
				id,
				options: {
					$select: ['commit'],
					$expand: {
						belongs_to__application: {
							$select: ['id'],
							$expand: {
								owns__device: {
									$select: ['id'],
									$filter: {
										should_be_running__release: null,
									},
								},
							},
						},
						contains__image: {
							$select: ['id'],
							$expand: {
								image: {
									$select: ['id'],
									$expand: {
										is_a_build_of__service: {
											$select: ['id'],
										},
									},
								},
							},
						},
					},
				},
			})
			.then((release: AnyObject) => {
				if (release == null) {
					return Promise.resolve(null);
				}
				return api.patch({
					resource: 'application',
					id: release.belongs_to__application[0].id,
					options: {
						$filter: {
							should_track_latest_release: true,
						},
					},
					body: {
						commit: release.commit,
					},
				});
			});
	}
};

sbvrUtils.addPureHook('PATCH', 'resin', 'release', {
	POSTRUN: args => {
		const { request } = args;
		// If we're updating a build by id and setting it successful then we update the application to this build
		if (request.odataQuery != null) {
			const keyBind = request.odataQuery.key;
			if (keyBind != null) {
				const id = sbvrUtils.resolveOdataBind(request.odataBinds, keyBind);
				return updateLatestRelease(id, args);
			}
		}
	},
});

sbvrUtils.addPureHook('POST', 'resin', 'release', {
	POSTRUN: args => {
		// If we're creating a build then check if the latest release needs to be updated
		const id = args.result;
		if (id != null) {
			return updateLatestRelease(id, args);
		}
	},
});

const releaseUpdateTimestampHook: sbvrUtils.Hooks = {
	POSTPARSE: ({ request }) => {
		request.values.update_timestamp = Date.now();
	},
};

sbvrUtils.addPureHook('PATCH', 'resin', 'release', releaseUpdateTimestampHook);
sbvrUtils.addPureHook('POST', 'resin', 'release', releaseUpdateTimestampHook);

addDeleteHookForDependents('release', [
	['release_tag', 'release'],
	['image__is_part_of__release', 'is_part_of__release'],
	['image_install', 'is_provided_by__release'],
]);
