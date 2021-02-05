import * as _ from 'lodash';

import { hooks } from '@balena/pinejs';
const releaseStateFields = [
	'status',
	'is_passing_tests',
	'release_type',
	'is_invalidated',
];
const updateLatestRelease = async ({ request, api }: hooks.HookArgs) => {
	if (
		// we avoid short-circuiting for POSTs since the db can provide defaults that we later use to filter on.
		request.method !== 'POST' &&
		!releaseStateFields.some((field) => field in request.values)
	) {
		return;
	}
	const [release] = await api.get({
		resource: 'release',
		options: {
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
				belongs_to__application: {
					$select: ['id'],
					$expand: {
						owns__device: {
							$select: ['id'],
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
	});
	if (release == null) {
		return;
	}
	await api.patch({
		resource: 'application',
		id: release.belongs_to__application[0].id,
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
		release.belongs_to__application[0].owns__device,
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
};

hooks.addPureHook('PATCH', 'resin', 'release', {
	POSTRUN: async (args) => {
		const { request } = args;
		// If we're updating a release by id and setting it successful then we update the application to this build
		if (request.affectedIds && request.affectedIds.length > 0) {
			await updateLatestRelease(args);
		}
	},
});

hooks.addPureHook('POST', 'resin', 'release', {
	POSTRUN: async (args) => {
		// If we successfully created a release then check if the latest release needs to be updated
		if (args.result != null) {
			await updateLatestRelease(args);
		}
	},
});
