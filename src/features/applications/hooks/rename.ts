import { hooks, errors } from '@balena/pinejs';

hooks.addPureHook('PATCH', 'resin', 'application', {
	POSTPARSE: ({ request }) => {
		const appName = request.values.app_name;

		if (appName) {
			if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
				throw new errors.BadRequestError(
					'App name may only contain [a-zA-Z0-9_-].',
				);
			}
		}
	},
});
