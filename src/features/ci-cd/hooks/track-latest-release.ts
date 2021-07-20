import * as _ from 'lodash';
import { sbvrUtils, hooks } from '@balena/pinejs';

const releaseStateFields = [
	'status',
	'is_passing_tests',
	'revision',
	'is_invalidated',
];

const updateLatestRelease = async (
	api: sbvrUtils.PinejsClient,
	releaseIds: number[],
) => {
	if (!releaseIds.length) {
		return;
	}

	const appsToUpdate = await api.get({
		resource: 'application',
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
						revision: { $ne: null },
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
	POSTRUN: async ({ api, request }) => {
		// If we're updating the ci/cd fields of any release (eg marking them as successful) then we update the application to track this release
		if (
			request.affectedIds &&
			request.affectedIds.length > 0 &&
			releaseStateFields.some((field) => field in request.values)
		) {
			await updateLatestRelease(api, request.affectedIds);
		}
	},
});

hooks.addPureHook('POST', 'resin', 'release', {
	POSTRUN: async ({ api, result: releaseId }) => {
		// If we successfully created a release then check if the latest release needs to be updated.
		// We avoid checking specific fields & short-circuiting since the db can provide defaults that we later use to filter on.
		if (releaseId != null) {
			await updateLatestRelease(api, [releaseId]);
		}
	},
});
