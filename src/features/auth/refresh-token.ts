import { errors, sbvrUtils } from '@balena/pinejs';
import { checkUserPassword, getUser } from '../../infra/auth/auth.ts';
import { updateUserXHR } from '../../infra/auth/jwt.ts';
import { captureException } from '../../infra/error-handling/index.ts';
import {
	createValidatedRequestHandler,
	z,
	type RequestExcludingInput,
} from '../../infra/validation/index.ts';

const { BadRequestError } = errors;

const refreshTokenBody = z.object({
	password: z.string().nullish(),
});

export type OnRefreshTokenFn = (options: {
	req: RequestExcludingInput & { body: z.infer<typeof refreshTokenBody> };
	tx: Tx;
}) => PromiseLike<void> | void;

let $onRefreshToken: OnRefreshTokenFn | undefined;
export function setOnRefreshToken(
	onRefreshToken: OnRefreshTokenFn | undefined,
) {
	$onRefreshToken = onRefreshToken;
}

export const refreshToken = createValidatedRequestHandler(
	{
		body: refreshTokenBody,
	},
	async (req, res) => {
		try {
			await sbvrUtils.db.readTransaction(async (tx) => {
				const { password } = req.body;

				if (password != null) {
					await getUser(req, tx, false);
					const creds = req.creds!;
					if (!('id' in creds)) {
						throw new BadRequestError('Can only password refresh user tokens');
					}
					await checkUserPassword(password, creds.id, tx);
					creds.authTime = Date.now();
				}
				await $onRefreshToken?.({ req, tx });
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
