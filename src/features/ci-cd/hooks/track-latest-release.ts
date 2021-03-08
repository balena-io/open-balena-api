import * as _ from 'lodash';

import { sbvrUtils, hooks } from '@balena/pinejs';

const updateLatestRelease = async (
	id: number,
	{ request, api }: hooks.HookArgs,
) => {
	// We only track builds that are successful
	if (request.values.status !== 'success') {
		return;
	}
	const release = await api.get({
		resource: 'release',
		id,
		options: {
			$select: 'id',
			$expand: {
				owns__release: {
					$select: 'id',
					$top: 1,
					// the most recently started build should be the latest, to ignore variable build times
					$orderby: { start_timestamp: 'desc' },
					$filter: {
						// We only track releases that are successful, final, not invalid, and passing tests
						release_type: 'final',
						is_passing_tests: true,
						is_invalidated: false,
						status: 'success',
					},
				},
			},
			$filter: {
				should_track_latest_release: true,
				owns__release: {
					$any: {
						$alias: 'r',
						$expr: {
							r: {
								id: { $in: releaseIds },
							},
						},
					},
				},
			},
		},
	});
	if (!appsToUpdate.length) {
		return;
	}

	await Promise.all(
		appsToUpdate.map(async (app) => {
			const [release] = app.owns__release;
			if (release == null) {
				return;
			}

			await api.patch({
				resource: 'application',
				id: app.id,
				options: {
					$filter: {
						should_track_latest_release: true,
					},
				},
				body: {
					should_be_running__release: release.id,
				},
			});
		}),
	);
};

hooks.addPureHook('PATCH', 'resin', 'release', {
	POSTRUN: async (args) => {
		const { request } = args;
		// If we're updating a build by id and setting it successful then we update the application to this build
		if (request.odataQuery != null) {
			const keyBind = request.odataQuery.key;
			// TODO: Support named keys
			if (keyBind != null && 'bind' in keyBind) {
				const id = sbvrUtils.resolveOdataBind(request.odataBinds, keyBind);
				await updateLatestRelease(id, args);
			}
		}
	},
});

hooks.addPureHook('POST', 'resin', 'release', {
	POSTRUN: async (args) => {
		// If we're creating a build then check if the latest release needs to be updated
		const id = args.result;
		if (id != null) {
			await updateLatestRelease(id, args);
		}
	},
});
