import type { Application, Request, RequestHandler } from 'express';
import * as morgan from 'morgan';
import { getServiceFromRequest } from '../../lib/auth';
import { getIP } from '../../lib/utils';

export type GetUrlFunction = (req: Request) => string;

export const skipLogging: RequestHandler = (req, _res, next) => {
	req.skipLogging = true;
	next();
};

// Retrieve information on who is calling the API endpoint.
// Returns a string in a form of 'a/{id}' or 'u/{id}' depending on what
// data is set by the upstream middleware.
// Prefixes meaning:
// - a/ - actor ID; usually set when an API key associated with a device is used for authentication;
// - u/ - user ID; used whenever we can extract a user info about the calls (both for API key and JWT auth);
// - s/ - service name; used when an internal balena service is making an API request.
const getCallerId = (req: Request) => {
	if (req.creds?.service || req.apiKey?.permissions?.includes('service')) {
		return `s/${getServiceFromRequest(req) || 'unknown'}`;
	}
	if (req.creds) {
		if (req.creds.actor) {
			return `a/${req.creds.actor}`;
		}
		if (req.creds.id) {
			return `u/${req.creds.id}`;
		}
	}
	if (req.apiKey && req.apiKey.actor) {
		return `a/${req.apiKey.actor}`;
	}
	return '-';
};
export const setupRequestLogging = (
	app: Application,
	getUrl: GetUrlFunction,
) => {
	let $getUrl = getUrl;
	if (app.get('env') === 'development') {
		$getUrl = (req) => {
			const url = getUrl(req);
			try {
				// unescape OData queries for readability when in dev mode
				return decodeURIComponent(url);
			} catch {
				return url;
			}
		};
	}

	app.use(
		morgan(
			(tokens, req, res) => {
				const date = new Date().toISOString();
				const url = $getUrl(req);
				const statusCode = tokens.status(req, res) || '-';
				const responseTime = tokens['response-time'](req, res) || '-';
				const balenaClient = req.headers['x-balena-client'] || '-';
				const callerId = getCallerId(req);

				return `${date} ${getIP(req)} ${callerId} ${
					req.method
				} ${url} ${statusCode} ${responseTime}ms ${balenaClient}`;
			},
			{
				skip: (req) => req.skipLogging as boolean,
			},
		),
	);
};
