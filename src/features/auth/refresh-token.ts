import { errors, sbvrUtils } from '@balena/pinejs';
import { checkUserPassword, getUser } from '../../infra/auth/auth.js';
import { updateUserXHR } from '../../infra/auth/jwt.js';
import { captureException } from '../../infra/error-handling/index.js';
import {
	createValidatedRequestHandler,
	z,
} from '../../infra/validation/index.js';
import type { SetupOptions } from '../../index.js';

const { BadRequestError } = errors;

export const refreshToken = (onRefreshToken: SetupOptions['onRefreshToken']) =>
	createValidatedRequestHandler(
		{
			body: z.object({
				password: z.string().nullish(),
			}),
		},
		async (req, res) => {
			try {
				await sbvrUtils.db.readTransaction(async (tx) => {
					const { password } = req.body;

					if (password != null) {
						await getUser(req, tx, false);
						const creds = req.creds!;
						if (!('id' in creds)) {
							throw new BadRequestError(
								'Can only password refresh user tokens',
							);
						}
						await checkUserPassword(password, creds.id, tx);
						creds.authTime = Date.now();
					}
					if (onRefreshToken) {
						const creds = req.creds!;
						if (!('id' in creds)) {
							throw new BadRequestError('Can only refresh user tokens');
						}
						await onRefreshToken(creds, tx, req);
					}
					await updateUserXHR(res, req, { tx });
				});
			} catch (err) {
				if (err instanceof BadRequestError) {
					res.status(401).end();
					return;
				}
				captureException(err, 'Error creating refreshed token');
				res.status(404).end();
			}
		},
	);
