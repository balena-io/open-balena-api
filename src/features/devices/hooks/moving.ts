import { sbvrUtils, hooks } from '@balena/pinejs';
import { TypedError } from 'typed-error';
import { checkDevicesCanBeInApplication } from '../../application-types/application-types';

const INVALID_NEWLINE_REGEX = /\r|\n/;
export const isDeviceNameValid = (name: string) => {
	return !INVALID_NEWLINE_REGEX.test(name);
};

// TODO: This should extend a HttpError
export class InaccessibleAppError extends TypedError {
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
				}) as Promise<Array<{ id: number }>>,
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
	POSTRUN: async (args) => {
		if (args.request.values.belongs_to__application != null) {
			// Also mark all image installs of moved devices as deleted because
			// they're for the previous application.
			const { movedDevices } = args.request.custom;
			if (movedDevices.length > 0) {
				await args.api.patch({
					resource: 'image_install',
					body: {
						status: 'deleted',
					},
					options: {
						$filter: {
							device: { $in: movedDevices },
						},
					},
				});
			}
		}
	},
});
