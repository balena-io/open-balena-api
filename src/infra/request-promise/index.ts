import request from 'request';

import { EXTERNAL_HTTP_TIMEOUT_MS } from '../../lib/config.js';

export type RequestResponse = [request.Response, any];

const defaultRequest = request.defaults({
	timeout: EXTERNAL_HTTP_TIMEOUT_MS,
});

export const requestAsync = (
	arg1:
		| (request.UriOptions & request.CoreOptions)
		| (request.UrlOptions & request.CoreOptions),
) => {
	return new Promise<RequestResponse>((resolve, reject) => {
		defaultRequest(arg1, (err: Error, res, body) => {
			if (err) {
				reject(err);
				return;
			}
			resolve([res, body]);
		});
	});
};

export default defaultRequest;
