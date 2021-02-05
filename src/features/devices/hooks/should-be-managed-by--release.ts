import { hooks, sbvrUtils } from '@balena/pinejs';
import { getAffectedIds } from '@balena/pinejs/out/sbvr-api/sbvr-utils';

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { request } = args;
		const deviceIds = await getAffectedIds(args);

		if (
			request.values.should_be_managed_by__release != null ||
			deviceIds.length === 0
		) {
			return;
		}

		/**
		 * These device(s) should have a valid release assigned based on their current
		 * running supervisor version, if we have one...
		 */

		const [device] = await args.api.get({
			resource: 'device',
			options: {
				$select: ['supervisor_version'],
				$expand: {
					is_for__device_type: {
						$expand: {
							is_of__cpu_architecture: {
								$select: 'id',
							},
						},
					},
				},
				$filter: {
					id: {
						$in: deviceIds,
					},
					should_be_managed_by__release: null,
				},
			},
		});

		if (!device) {
			return;
		}

		const [supervisorRelease] = await getSupervisorReleaseResource(
			args.api,
			device.supervisor_version,
			device.is_for__device_type.is_of__cpu_architecture.id,
		);

		if (!supervisorRelease) {
			return;
		}

		request.values.should_be_managed_by__release = supervisorRelease.id;
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
			$expand: {
				belongs_to__application: {
					$select: ['is_for__device_type'],
				},
			},
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
