import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import * as _ from 'lodash';

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * When a device checks in with it's initial OS version, set the corresponding should_have_hostapp__release resource
	 * using its current reported version.
	 */
	async PRERUN(args) {
		if (args.request.values.os_version != null) {
			await sbvrUtils.getAffectedIds(args).then(async (ids) => {
				await setOSReleaseResource(
					args.api,
					ids,
					args.request.values.os_version,
				);
			});
		}
	},
});

async function setOSReleaseResource(
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	osVersion: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			// if the device already has an os_version, just bail.
			$filter: {
				id: { $in: deviceIds },
				os_version: null,
			},
			$select: ['id', 'is_of__device_type'],
		},
	});

	if (devices.length === 0) {
		return;
	}

	const devicesByDeviceType = _.groupBy(devices, (d) => {
		return d.is_of__device_type.__id;
	});

	if (Object.keys(devicesByDeviceType).length === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
		},
	});

	return Promise.all(
		_.map(devicesByDeviceType, async (affectedDevices, deviceType) => {
			const affectedDeviceIds = affectedDevices.map((d) => d.id);

			const [osRelease] = await getOSReleaseResource(
				api,
				osVersion,
				deviceType,
			);

			if (osRelease == null) {
				return;
			}

			await rootApi.patch({
				resource: 'device',
				options: {
					$filter: {
						id: { $in: affectedDeviceIds },
					},
				},
				body: {
					should_have_hostapp__release: osRelease.id,
				},
			});
		}),
	);
}

async function getOSReleaseResource(
	api: sbvrUtils.PinejsClient,
	osVersion: string,
	deviceTypeId: string,
) {
	return await api.get({
		resource: 'release',
		options: {
			$select: ['id', 'belongs_to__application'],
			$filter: {
				// TODO: maybe better to use release tags (to respect variant and version, though bleh)
				release_version: osVersion,
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							$and: [
								{
									a: {
										is_for__device_type: deviceTypeId,
									},
								},
								{
									a: {
										is_host: true,
									},
								},
							],
						},
					},
				},
			},
		},
	});
}
