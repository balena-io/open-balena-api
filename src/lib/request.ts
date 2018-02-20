import * as request from 'request';
import * as Promise from 'bluebird';
import { EXTERNAL_HTTP_TIMEOUT_MS } from './config';

type Request = typeof request;
request.get;

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

const defaultedRequest = request.defaults({
	timeout: EXTERNAL_HTTP_TIMEOUT_MS,
});

export = (Promise.promisifyAll(defaultedRequest, {
	multiArgs: true,
}) as any) as PromisifiedRequest;
