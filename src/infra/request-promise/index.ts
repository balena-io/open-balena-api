import request from 'request';

import { EXTERNAL_HTTP_TIMEOUT_MS } from '../../lib/config.js';

export type RequestResponse = [request.Response, any];

const defaultRequest = request.defaults({
	timeout: EXTERNAL_HTTP_TIMEOUT_MS,
});

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const withRetry = async <T>(
	fn: () => Promise<T>,
	retries: number,
	baseDelay = 1000,
	attempt = 0,
): Promise<T> => {
	try {
		return await fn();
	} catch (error) {
		if (retries <= 0) {
			throw error;
		}

		const waitTime = baseDelay * Math.pow(2, attempt);

		await delay(waitTime);
		return withRetry(fn, retries - 1, baseDelay, attempt + 1);
	}
};

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
