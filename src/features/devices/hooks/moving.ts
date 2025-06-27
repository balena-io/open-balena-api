import { sbvrUtils, hooks, errors } from '@balena/pinejs';
import { checkDevicesCanBeInApplication } from '../../application-types/application-types.js';

const INVALID_NEWLINE_REGEX = /\r|\n/;
export const isDeviceNameValid = (name: string) => {
	return !INVALID_NEWLINE_REGEX.test(name);
};

export class InaccessibleAppError extends errors.NotFoundError {
	constructor(
		message = "Application doesn't exist or you have no access to it.",
	) {
		super(message);
	}
}

hooks.addPureHook('PATCH', 'resin', 'device', {
	PRERUN: async (args) => {
		const { api, request } = args;

		if (request.values.belongs_to__application != null) {
			let app;
			try {
				app = await api.get({
					resource: 'application',
					id: request.values.belongs_to__application,
					options: {
						$select: 'id',
					},
				});
			} catch {
				throw new InaccessibleAppError();
			}
			if (app == null) {
				throw new InaccessibleAppError();
			}

			const deviceIds = await sbvrUtils.getAffectedIds(args);
			if (deviceIds.length === 0) {
				return;
			}
			const [devices] = await Promise.all([
				args.api.get({
					resource: 'device',
					options: {
						$select: 'id',
						$filter: {
							id: {
								$in: deviceIds,
							},
							belongs_to__application: {
								$ne: args.request.values.belongs_to__application,
							},
						},
					},
				}),
				checkDevicesCanBeInApplication(
					api,
					request.values.belongs_to__application,
					deviceIds,
				),
			]);

			// get the devices being affected and store them for the POSTRUN...
			request.custom.movedDevices = devices.map((device) => device.id);
		}
	},
	POSTRUN: async ({ request, api }) => {
		if (request.values.belongs_to__application != null) {
			// Also mark all image installs of moved devices as deleted because
			// they're for the previous application.
			const { movedDevices } = request.custom;
			if (movedDevices != null && movedDevices.length > 0) {
				const body = {
					status: 'deleted' as const,
					download_progress: null,
				};
				await api.patch({
					resource: 'image_install',
					body,
					options: {
						$filter: {
							device: { $in: movedDevices },
							$not: body,
						},
					},
				});
			}
		}
	},
});
