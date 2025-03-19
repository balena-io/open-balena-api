import cluster from 'cluster';
import type { Request, Response, RequestHandler } from 'express';
import _ from 'lodash';
import type { IRateLimiterOptions } from 'rate-limiter-flexible';
import {
	RateLimiterCluster,
	RateLimiterMemory,
	RateLimiterRedis,
	RateLimiterRes,
} from 'rate-limiter-flexible';
import { captureException, handleHttpErrors } from '../error-handling/index.js';
import {
	RATE_LIMIT_FACTOR,
	RATE_LIMIT_MEMORY_BACKEND,
} from '../../lib/config.js';
import { errors } from '@balena/pinejs';
import { redis } from '../redis/index.js';

const { TooManyRequestsError } = errors;

const usedKeyScopes: Dictionary<true> = {};

// Use redis as a store.
export const createRateLimiter = (
	keyScope: string,
	opts: IRateLimiterOptions,
) => {
	if (usedKeyScopes[keyScope] === true) {
		throw new Error(
			`RateLimiter scope key '${keyScope}' has already been taken`,
		);
	}
	usedKeyScopes[keyScope] = true;

	if (opts.points != null) {
		opts.points *= RATE_LIMIT_FACTOR;
	}

	let insuranceLimiter;
	if (cluster.isPrimary) {
		insuranceLimiter = new RateLimiterMemory({
			...opts,
			keyPrefix: `api:ratelimiting:memory:${keyScope}`,
		});
	} else {
		insuranceLimiter = new RateLimiterCluster({
			...opts,
			keyPrefix: `api:ratelimiting:cluster:${keyScope}`,
			timeoutMs: 3000, // Promise is rejected, if master doesn't answer for 3 secs
		});
	}

	if (RATE_LIMIT_MEMORY_BACKEND != null) {
		return insuranceLimiter;
	}

	const rateLimiter = new RateLimiterRedis({
		...opts,
		keyPrefix: `api:ratelimiting:redis:${keyScope}`,
		storeClient: redis,
		insuranceLimiter,
	});

	return {
		consume: async (...args: Parameters<RateLimiterRedis['consume']>) => {
			try {
				return await rateLimiter.consume(...args);
			} catch (e) {
				if (e instanceof RateLimiterRes) {
					const headers: { [header: string]: string } = {};
					if (e.msBeforeNext) {
						headers['Retry-After'] = `${Math.ceil(e.msBeforeNext / 1000)}`;
					}
					throw new TooManyRequestsError(
						'Too Many Requests',
						undefined,
						headers,
					);
				}
				throw e;
			}
		},
		penalty: async (...args: Parameters<RateLimiterRedis['penalty']>) => {
			return await rateLimiter.penalty(...args);
		},
		delete: async (...args: Parameters<RateLimiterRedis['delete']>) => {
			return await rateLimiter.delete(...args);
		},
	};
};

export const getUserIDFromCreds = (req: Request): string => {
	if (req.creds != null && 'id' in req.creds) {
		return `userID:${req.creds.id}`;
	}
	return `nouserID`;
};

export type RateLimitKeyFn = (
	req: Request,
	res: Response,
) => Resolvable<string>;
export type RateLimitKey = string | RateLimitKeyFn;

export type RateLimitMiddleware = (
	...args: Parameters<RequestHandler>
) => Promise<string | undefined>;

export type PartialRateLimitMiddleware = (
	field?: RateLimitKey,
) => RateLimitMiddleware;

export const createRateLimitMiddleware = (
	rateLimiter: ReturnType<typeof createRateLimiter>,
	keyOpts: Parameters<typeof $createRateLimitMiddleware>[1] = {},
): PartialRateLimitMiddleware =>
	_.partial($createRateLimitMiddleware, rateLimiter, keyOpts);

/**
 * If 'field' is set, the middleware will apply the rate limit to requests
 * that originate from the same IP *and* have the same 'field'.
 *
 * If 'field' is not set, the rate limit will be applied to *all* requests
 * originating from a particular IP.
 */
const $createRateLimitMiddleware = (
	rateLimiter: ReturnType<typeof createRateLimiter>,
	{
		ignoreIP = false,
		allowReset = true,
	}: { ignoreIP?: boolean; allowReset?: boolean } = {},
	field?: RateLimitKey,
): RateLimitMiddleware => {
	let fieldFn: RateLimitKeyFn;
	if (field != null) {
		if (typeof field === 'function') {
			fieldFn = field;
		} else {
			const path = _.toPath(field);
			fieldFn = (req) => _.get(req, path);
		}
	} else {
		fieldFn = () => '';
	}
	let keyFn: RateLimitKeyFn;
	if (ignoreIP) {
		keyFn = fieldFn;
	} else {
		keyFn = async (req, res) => req.ip + '$' + (await fieldFn(req, res));
	}
	const addReset = !allowReset
		? _.noop
		: (req: Request, key: string) => {
				const resetRatelimit = req.resetRatelimit;
				req.resetRatelimit = async () => {
					try {
						await Promise.all([rateLimiter.delete(key), resetRatelimit?.()]);
					} catch (err) {
						captureException(err, 'Error failed to reset rate limit counter');
					}
				};
			};
	return async (req, res, next) => {
		try {
			const key = await keyFn(req, res);
			await rateLimiter.consume(key);
			addReset(req, key);
			next();
			return key;
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error during rate limiting');
			res.status(500).end();
		}
	};
};
