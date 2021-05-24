import * as Bluebird from 'bluebird';
import * as request from 'request';

import { EXTERNAL_HTTP_TIMEOUT_MS } from '../../lib/config';

type Request = typeof request;

export type RequestResponse = [request.Response, any];

interface PromisifiedRequest extends Request {
	getAsync(
		options:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	): Bluebird<RequestResponse>;
	getAsync(
		uri: string,
		options?: request.CoreOptions,
	): Bluebird<RequestResponse>;

	postAsync: (
		arg1:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	) => Bluebird<RequestResponse>;
	putAsync: (
		arg1:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	) => Bluebird<RequestResponse>;
	delAsync: (
		arg1:
			| (request.UriOptions & request.CoreOptions)
			| (request.UrlOptions & request.CoreOptions),
	) => Bluebird<RequestResponse>;
}

export const defaultRequest = request.defaults({
	timeout: EXTERNAL_HTTP_TIMEOUT_MS,
});

const promisifiedRequest = Bluebird.promisifyAll(defaultRequest, {
	multiArgs: true,
}) as any as PromisifiedRequest;

export const requestAsync = Bluebird.promisify(promisifiedRequest, {
	multiArgs: true,
}) as any as (
	arg1:
		| (request.UriOptions & request.CoreOptions)
		| (request.UrlOptions & request.CoreOptions),
) => Bluebird<RequestResponse>;

export default promisifiedRequest;
