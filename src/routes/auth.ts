import { RequestHandler } from 'express';

import { resinApi } from '../platform';
import { handleHttpErrors } from '../platform/errors';

export const getUserPublicKeys: RequestHandler = (req, res) => {
	const { username } = req.params;

	if (username == null) {
		return res.send(400);
	}

	return resinApi
		.get({
			resource: 'user__has__public_key',
			options: {
				$select: 'public_key',
				$filter: {
					user: {
						$any: {
							$alias: 'u',
							$expr: {
								u: { username },
							},
						},
					},
				},
			},
			passthrough: { req },
		})
		.then((data: Array<{ public_key: string }>) => {
			const authorizedKeys = data.map(e => e.public_key).join('\n');
			res.status(200).send(authorizedKeys);
		})
		.catch(err => {
			handleHttpErrors(req, res, err);
		});
};
