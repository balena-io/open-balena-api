import { hooks, sbvrUtils, permissions } from '@balena/pinejs';
import * as _ from 'lodash';

hooks.addPureHook('PATCH', 'resin', 'device', {
	/**
	 * When a device checks in with it's initial supervisor version, set the corresponding should_be_managed_by__release resource
	 * using its current reported version.
	 */
	async PRERUN(args) {
		if (args.request.values.supervisor_version != null) {
			await sbvrUtils.getAffectedIds(args).then(async (ids) => {
				await setSupervisorReleaseResource(
					args.api,
					ids,
					args.request.values.supervisor_version,
				);
			});
		}
	},
});

async function getSupervisorReleaseResource(
	api: sbvrUtils.PinejsClient,
	supervisorVersion: string,
	archId: string,
) {
	return await api.get({
		resource: 'release',
		options: {
			$select: ['id', 'release_version'],
			$filter: {
				release_version: `v${supervisorVersion}`,
				status: 'success',
				belongs_to__application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								is_public: true,
								is_host: false,
								is_for__device_type: {
									$any: {
										$alias: 'dt',
										$expr: {
											dt: {
												is_of__cpu_architecture: {
													$any: {
														$alias: 'c',
														$expr: {
															c: {
																id: archId,
															},
														},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	});
}

async function setSupervisorReleaseResource(
	api: sbvrUtils.PinejsClient,
	deviceIds: number[],
	supervisorVersion: string,
) {
	if (deviceIds.length === 0) {
		return;
	}
	const devices = await api.get({
		resource: 'device',
		options: {
			// if the device already has a supervisor_version, just bail.
			$filter: {
				id: { $in: deviceIds },
				supervisor_version: null,
			},
			$select: ['id'],
			$expand: {
				is_of__device_type: { $select: ['is_of__cpu_architecture', 'id'] },
			},
		},
	});

	if (devices.length === 0) {
		return;
	}

	const devicesByDeviceTypeArch = _.groupBy(devices, (d) => {
		return d.is_of__device_type[0].is_of__cpu_architecture.__id;
	});

	if (Object.keys(devicesByDeviceTypeArch).length === 0) {
		return;
	}

	const rootApi = api.clone({
		passthrough: {
			req: permissions.root,
		},
	});

	return Promise.all(
		_.map(devicesByDeviceTypeArch, async (affectedDevices, deviceTypeArch) => {
			const affectedDeviceIds = affectedDevices.map((d) => d.id);

			const [supervisorRelease] = await getSupervisorReleaseResource(
				api,
				supervisorVersion,
				deviceTypeArch,
			);

			if (supervisorRelease == null) {
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
					should_be_managed_by__release: supervisorRelease.id,
				},
			});
		}),
	);
}
