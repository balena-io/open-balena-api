import * as request from 'request';
import * as Promise from 'bluebird';
import { EXTERNAL_HTTP_TIMEOUT_MS } from './config';

type Request = typeof request;

export type RequestResponse = [request.Response, any];

interface PromisifiedRequest extends Request {
	getAsync(
		options:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	): Promise<RequestResponse>;
	getAsync(
		uri: string,
		options?: request.CoreOptions,
	): Promise<RequestResponse>;

	postAsync: (
		arg1:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	) => Promise<RequestResponse>;
	putAsync: (
		arg1:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	) => Promise<RequestResponse>;
	delAsync: (
		arg1:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	) => Promise<RequestResponse>;
}

export const defaultRequest = request.defaults({
	timeout: EXTERNAL_HTTP_TIMEOUT_MS,
});

const promisifiedRequest = (Promise.promisifyAll(defaultRequest, {
	multiArgs: true,
}) as any) as PromisifiedRequest;

export const requestAsync = (Promise.promisify(promisifiedRequest, {
	multiArgs: true,
}) as any) as (
	arg1:
		| (request.UriOptions & request.CoreOptions)
		| (request.UrlOptions & request.CoreOptions),
) => Promise<RequestResponse>;

export default promisifiedRequest;
