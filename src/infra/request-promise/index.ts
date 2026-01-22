import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

import { EXTERNAL_HTTP_TIMEOUT_MS } from '../../lib/config.js';

export interface RequestOptions {
	uri?: string;
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	json?: any;
	qs?: Record<string, string | number | undefined>;
	timeout?: number;
	gzip?: boolean;
	proxy?: string;
	tunnel?: boolean;
}

export interface RequestResponseObject {
	statusCode: number;
	headers: Record<string, string | undefined>;
	body?: any;
}

export type RequestResponse = [RequestResponseObject, any];

/**
 * Makes an HTTP request that can tunnel through a CONNECT proxy.
 * This replicates the behavior of the deprecated 'request' library with tunnel:true.
 */
export const requestAsync = async (
	options: RequestOptions,
): Promise<RequestResponse> => {
	const targetUrl = options.uri ?? options.url;
	if (!targetUrl) {
		throw new Error('URL is required');
	}

	const url = new URL(targetUrl);

	// Add query string parameters
	if (options.qs) {
		for (const [key, value] of Object.entries(options.qs)) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const timeout = options.timeout ?? EXTERNAL_HTTP_TIMEOUT_MS;
	const method = options.method ?? 'GET';

	const requestHeaders: Record<string, string> = {
		...options.headers,
	};

	// Handle gzip
	if (options.gzip) {
		requestHeaders['Accept-Encoding'] = 'gzip, deflate';
	}

	let body: string | undefined;
	if (options.json !== undefined) {
		requestHeaders['Content-Type'] = 'application/json';
		body = JSON.stringify(options.json);
	}

	// If tunneling through a proxy, we need to use CONNECT method first
	if (options.proxy && options.tunnel) {
		return await makeRequestThroughTunnel(
			url,
			options.proxy,
			method,
			requestHeaders,
			body,
			timeout,
		);
	}

	// Simple fetch-based request for non-proxy cases
	return await makeDirectRequest(url, method, requestHeaders, body, timeout);
};

async function makeDirectRequest(
	url: URL,
	method: string,
	headers: Record<string, string>,
	body: string | undefined,
	timeout: number,
): Promise<RequestResponse> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, timeout);

	try {
		const response = await fetch(url.toString(), {
			method,
			headers,
			body,
			signal: controller.signal,
		});

		const contentType = response.headers.get('content-type') ?? '';
		let responseBody: any;

		if (contentType.includes('application/json')) {
			responseBody = await response.json();
		} else {
			responseBody = await response.text();
		}

		const headersObject: Record<string, string | undefined> = {};
		response.headers.forEach((value, key) => {
			headersObject[key] = value;
		});

		const responseObj: RequestResponseObject = {
			statusCode: response.status,
			headers: headersObject,
			body: responseBody,
		};

		return [responseObj, responseBody];
	} finally {
		clearTimeout(timeoutId);
	}
}

async function makeRequestThroughTunnel(
	url: URL,
	proxyUrl: string,
	method: string,
	headers: Record<string, string>,
	body: string | undefined,
	timeout: number,
): Promise<RequestResponse> {
	const proxy = new URL(proxyUrl);

	// Create the tunnel first using CONNECT
	const socket = await new Promise<import('node:net').Socket>(
		(resolve, reject) => {
			const proxyRequestOptions: http.RequestOptions = {
				hostname: proxy.hostname,
				port: parseInt(proxy.port, 10) ?? 80,
				method: 'CONNECT',
				path: `${url.hostname}:${url.port ?? (url.protocol === 'https:' ? 443 : 80)}`,
				headers: {},
				timeout,
			};

			// Handle proxy authentication
			if (proxy.username) {
				const auth = Buffer.from(
					`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password ?? '')}`,
				).toString('base64');
				proxyRequestOptions.headers = {
					'Proxy-Authorization': `Basic ${auth}`,
				};
			}

			const proxyRequest = http.request(proxyRequestOptions);

			proxyRequest.on('connect', (_res, connectedSocket) => {
				resolve(connectedSocket);
			});

			proxyRequest.on('error', reject);
			proxyRequest.on('timeout', () => {
				proxyRequest.destroy();
				reject(new Error('Proxy connection timeout'));
			});

			proxyRequest.end();
		},
	);

	// Now make the actual request through the tunnel
	return await new Promise<RequestResponse>((resolve, reject) => {
		const isHttps = url.protocol === 'https:';
		const requestModule = isHttps ? https : http;

		const requestOptions: http.RequestOptions = {
			hostname: url.hostname,
			port: url.port ?? (isHttps ? 443 : 80),
			path: url.pathname + url.search,
			method,
			headers,
			timeout,
			...(isHttps
				? { socket, servername: url.hostname }
				: { createConnection: () => socket }),
		};

		const req = requestModule.request(requestOptions, (res) => {
			const chunks: Buffer[] = [];

			res.on('data', (chunk: Buffer) => {
				chunks.push(chunk);
			});

			res.on('end', () => {
				const bodyBuffer = Buffer.concat(chunks);
				const contentType = res.headers['content-type'] ?? '';
				let responseBody: any;

				if (contentType.includes('application/json')) {
					try {
						responseBody = JSON.parse(bodyBuffer.toString('utf-8'));
					} catch {
						responseBody = bodyBuffer.toString('utf-8');
					}
				} else {
					responseBody = bodyBuffer.toString('utf-8');
				}

				// Convert IncomingHttpHeaders to simple string record
				const headersObject: Record<string, string | undefined> = {};
				for (const [key, value] of Object.entries(res.headers)) {
					headersObject[key] = Array.isArray(value) ? value.join(', ') : value;
				}

				const responseObj: RequestResponseObject = {
					statusCode: res.statusCode ?? 500,
					headers: headersObject,
					body: responseBody,
				};

				resolve([responseObj, responseBody]);
			});

			res.on('error', reject);
		});

		req.on('error', (error) => {
			socket.destroy();
			reject(error);
		});

		req.on('timeout', () => {
			req.destroy();
			socket.destroy();
			reject(new Error('Request timeout'));
		});

		if (body) {
			req.write(body);
		}

		req.end();
	});
}
