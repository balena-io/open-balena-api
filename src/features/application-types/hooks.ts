import { hooks, errors } from '@balena/pinejs';
import { checkDevicesCanBeInApplication } from './application-types';

export class InaccessibleAppError extends errors.UnauthorizedError {
	constructor(
		message = "Application doesn't exist or you have no access to it.",
	) {
		super(message);
	}
}

hooks.addPureHook('POST', 'resin', 'device_application', {
	PRERUN: async (args) => {
		const { api, request } = args;

		const app = await api
			.get({
				resource: 'application',
				id: request.values.belongs_to__application,
				options: {
					$select: 'id',
				},
			})
			.catch(() => {
				throw new InaccessibleAppError();
			});

		if (app == null) {
			throw new InaccessibleAppError();
		}

		const deviceIds = [request.values.device];
		await checkDevicesCanBeInApplication(
			api,
			request.values.belongs_to__application,
			deviceIds,
		);
	},
});
