import * as _ from 'lodash';
import { sbvrUtils, hooks } from '@balena/pinejs';

const releaseStateFields = [
	'status',
	'is_passing_tests',
	'release_type',
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
				owns__device: {
					$select: ['id'],
				},
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
					$expand: {
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
			},
			$filter: {
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

			const deviceIds: number[] = _.map(
				app.owns__device,
				(device) => device.id,
			);
			const serviceIds: number[] = _.map(
				release.contains__image,
				(ipr) => ipr.image[0].is_a_build_of__service[0].id,
			);
			if (deviceIds.length === 0 || serviceIds.length === 0) {
				return;
			}
			const serviceInstalls = await api.get({
				resource: 'service_install',
				options: {
					$select: ['device', 'installs__service'],
					$filter: {
						device: { $in: deviceIds },
						installs__service: { $in: serviceIds },
					},
				},
			});
			const serviceInstallsByDevice = _.groupBy(
				serviceInstalls,
				(si) => si.device.__id as number,
			);
			await Promise.all(
				deviceIds.map(async (deviceId) => {
					const existingServiceIds: number[] = _.map(
						serviceInstallsByDevice[deviceId],
						(si) => si.installs__service.__id,
					);
					const deviceServiceIds = _.difference(serviceIds, existingServiceIds);
					await Promise.all(
						deviceServiceIds.map(async (serviceId) => {
							await api.post({
								resource: 'service_install',
								body: {
									device: deviceId,
									installs__service: serviceId,
								},
								options: { returnResource: false },
							});
						}),
					);
				}),
			);
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
