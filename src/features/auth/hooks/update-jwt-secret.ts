import { hooks } from '@balena/pinejs';
import { generateNewJwtSecret } from '../../../infra/auth/jwt';

hooks.addPureHook('POST', 'resin', 'user', {
	/**
	 * Default the jwt secret on signup
	 */
	async POSTPARSE({ request }) {
		request.values.jwt_secret = await generateNewJwtSecret();
	},
});

hooks.addPureHook('PATCH', 'resin', 'user', {
	/**
	 * Logout existing sessions on field changes
	 */
	async POSTPARSE({ request }) {
		if (
			request.values.password !== undefined ||
			request.values.username !== undefined
		) {
			request.values.jwt_secret = await generateNewJwtSecret();
		}
	},
});
