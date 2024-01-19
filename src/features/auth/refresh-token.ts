import { errors, sbvrUtils } from '@balena/pinejs';
import { checkUserPassword, getUser } from '../../infra/auth/auth';
import { updateUserXHR } from '../../infra/auth/jwt';
import { captureException } from '../../infra/error-handling';
import type { RequestHandler } from 'express';

import type { SetupOptions } from '../..';

const { BadRequestError } = errors;

let onTokenRefresh: SetupOptions['onTokenRefresh'];
export const setOnTokenRefresh = (
	onTokenRefreshFn: SetupOptions['onTokenRefresh'],
) => {
	onTokenRefresh = onTokenRefreshFn;
};

export const refreshToken: RequestHandler = async (req, res) => {
	try {
		await sbvrUtils.db.readTransaction(async (tx) => {
			const { password } = req.body;
			const user = await getUser(req, tx);

			if (password != null) {
				const creds = req.creds!;
				if (!('id' in creds)) {
					throw new BadRequestError('Can only password refresh user tokens');
				}
				await checkUserPassword(password, creds.id, tx);
				creds.authTime = Date.now();
			}
			if (onTokenRefresh != null) {
				await onTokenRefresh(user.id, tx);
			}
			await updateUserXHR(res, req, { tx });
		});
	} catch (err) {
		if (err instanceof BadRequestError) {
			res.status(401).end();
			return;
		}
		captureException(err, 'Error creating refreshed token', { req });
		res.status(404).end();
	}
};
