import request from 'request';

import { EXTERNAL_HTTP_TIMEOUT_MS } from '../../lib/config.ts';

// Nothing in this repo uses these anymore (it uses `fetch`). They are only kept because they are
// part of the public API (exported as `request` from the package entrypoint), and wrap the
// unmaintained `request` package. To be removed, along with that dependency, in the next major.

/** @deprecated Use `fetch`. */
export type RequestResponse = [request.Response, any];

/** @deprecated Use `fetch`. */
const defaultRequest = request.defaults({
	timeout: EXTERNAL_HTTP_TIMEOUT_MS,
});

/** @deprecated Use `fetch`. */
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
