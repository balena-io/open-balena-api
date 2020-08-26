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
				belongs_to__application: {
					$select: ['id'],
					$expand: {
						device_application: {
							$select: 'device',
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
		release.belongs_to__application[0].device_application,
		(da) => da.device.__id,
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
