import { hooks, errors } from '@balena/pinejs';
import { DefaultApplicationType } from '../../application-types/application-types';

hooks.addPureHook('POST', 'resin', 'application', {
	POSTPARSE: async (args) => {
		const { request } = args;
		const appName = request.values.app_name;

		request.values.application_type ??= DefaultApplicationType.id;

		if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
			throw new errors.BadRequestError(
				'App name may only contain [a-zA-Z0-9_-].',
			);
		}

		request.values.should_track_latest_release = true;
		request.values.slug ??= appName.toLowerCase();
	},
});
