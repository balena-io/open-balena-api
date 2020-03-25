import { sbvrUtils } from '@resin/pinejs';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import { addDeleteHookForDependents } from '../../platform';

const updateLatestRelease = async (
	id: number,
	{ request, api }: sbvrUtils.HookArgs,
) => {
	// We only track builds that are successful
	if (request.values.status !== 'success') {
		return;
	}
	const release = (await api.get({
		resource: 'release',
		id,
		options: {
			$select: 'id',
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
	})) as AnyObject;
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
	const serviceInstalls = (await api.get({
		resource: 'service_install',
		options: {
			$select: ['device', 'installs__service'],
			$filter: {
				device: { $in: deviceIds },
				installs__service: { $in: serviceIds },
			},
		},
	})) as AnyObject[];
	const serviceInstallsByDevice = _.groupBy(
		serviceInstalls,
		(si) => si.device.__id as number,
	);
	return Bluebird.map(deviceIds, (deviceId) => {
		const existingServiceIds: number[] = _.map(
			serviceInstallsByDevice[deviceId],
			(si) => si.installs__service.__id,
		);
		const deviceServiceIds = _.difference(serviceIds, existingServiceIds);
		return Bluebird.map(deviceServiceIds, (serviceId) =>
			api.post({
				resource: 'service_install',
				body: {
					device: deviceId,
					installs__service: serviceId,
				},
				options: { returnResource: false },
			}),
		);
	});
};

sbvrUtils.addPureHook('PATCH', 'resin', 'release', {
	POSTRUN: (args) => {
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
	POSTRUN: (args) => {
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
