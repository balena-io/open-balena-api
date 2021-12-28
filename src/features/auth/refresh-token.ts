import { errors } from '@balena/pinejs';
import { checkUserPassword, getUser } from '../../infra/auth/auth';
import { updateUserXHR } from '../../infra/auth/jwt';
import { captureException } from '../../infra/error-handling';
import type { RequestHandler } from 'express';

const { BadRequestError } = errors;

export const refreshToken: RequestHandler = async (req, res) => {
	try {
		const { password } = req.body;

		if (password != null) {
			await getUser(req, false);
			const creds = req.creds!;
			if (!('id' in creds)) {
				throw new BadRequestError('Can only password refresh user tokens');
			}
			await checkUserPassword(password, creds.id);
			creds.authTime = Date.now();
		}
		await updateUserXHR(res, req);
	} catch (err) {
		if (err instanceof BadRequestError) {
			res.status(401).end();
			return;
		}
		captureException(err, 'Error creating refreshed token', { req });
		res.status(404).end();
	}
};
