import { hooks, sbvrUtils } from '@balena/pinejs';

const INVALID_NEWLINE_REGEX = /\r|\n/;
export const isDeviceNameValid = (name: string) => {
	return !INVALID_NEWLINE_REGEX.test(name);
};

hooks.addPureHook('DELETE', 'resin', 'device_application', {
	PRERUN: async (args) => {
		const { api, request } = args;
		const deviceAppIds = await sbvrUtils.getAffectedIds(args);
		let deviceIds: number[];
		if (deviceAppIds.length === 0) {
			deviceIds = [];
		} else {
			const deviceApps = (await api.get({
				resource: 'device_application',
				options: {
					$select: 'device',
					$filter: {
						id: {
							$in: deviceAppIds,
						},
					},
				},
			})) as Array<{ device: { __id: number } }>;

			deviceIds = deviceApps.map(({ device }) => device.__id);

			// When moving application make sure to set the build to null instead of pointing to a build of the wrong application
			await args.api.patch({
				resource: 'device',
				body: {
					should_be_running__release: null,
				},
				options: {
					$filter: {
						id: {
							$in: deviceIds,
						},
					},
				},
			});
		}
		// Store the devices being affected for the POSTRUN
		request.custom.deviceIds = deviceIds;
	},
	POSTRUN: async ({ request, api }) => {
		const { deviceIds } = request.custom;
		if (deviceIds.length > 0) {
			await Promise.all([
				// Also mark all image installs of moved devices as deleted because
				// they're for the previous application.
				api.patch({
					resource: 'image_install',
					body: {
						status: 'deleted',
					},
					options: {
						$filter: {
							device: { $in: deviceIds },
						},
					},
				}),
				// And remove the service installs
				api.delete({
					resource: 'service_install',
					options: {
						$filter: {
							device: { $in: deviceIds },
						},
					},
				}),
			]);
		}
	},
});
