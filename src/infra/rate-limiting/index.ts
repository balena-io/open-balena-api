import * as cluster from 'cluster';
import type { Request, Response, RequestHandler } from 'express';
import * as _ from 'lodash';
import {
	IRateLimiterOptions,
	RateLimiterCluster,
	RateLimiterMemory,
	RateLimiterRedis,
	RateLimiterRes,
} from 'rate-limiter-flexible';
import * as Redis from 'ioredis';

import { captureException, handleHttpErrors } from '../error-handling';

import {
	MINUTES,
	RATE_LIMIT_FACTOR,
	RATE_LIMIT_MEMORY_BACKEND,
	REDIS_HOST,
	REDIS_PORT,
} from '../../lib/config';
import { errors } from '@balena/pinejs';

const { InternalRequestError, TooManyRequestsError } = errors;

const logRedisError = (err: Error) => {
	// do not log these errors, because this would flood our logs
	// when redis is offline
	// these errors are throttle see below
	captureException(err, 'Error: Redis service communication failed ');
};

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy: NonNullable<
	ConstructorParameters<typeof Redis>[0]
>['retryStrategy'] = _.constant(200);

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

	const client = new Redis({
		host: REDIS_HOST,
		port: REDIS_PORT,
		retryStrategy: redisRetryStrategy,
		enableOfflineQueue: false,
	});

	// we need to bind to this error handler otherwise a redis error would kill
	// the whole process
	client.on('error', _.throttle(logRedisError, 5 * MINUTES));

	const rateLimiter = new RateLimiterRedis({
		...opts,
		keyPrefix: `api:ratelimiting:redis:${keyScope}`,
		storeClient: client,
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
						headers['Retry-After'] = `${Math.round(e.msBeforeNext / 1000)}`;
					}
					throw new TooManyRequestsError(
						'Too Many Requests',
						undefined,
						headers,
					);
				} else {
					throw new InternalRequestError();
				}
			}
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

export type PartialRateLimitMiddleware = (
	field?: RateLimitKey,
) => RequestHandler;

export const createRateLimitMiddleware = (
	rateLimiter: ReturnType<typeof createRateLimiter>,
	keyOpts: Parameters<typeof $createRateLimitMiddleware>[1] = {},
): PartialRateLimitMiddleware =>
	_.partial($createRateLimitMiddleware, rateLimiter, keyOpts);

// If 'field' is set, the middleware will apply the rate limit to requests
// that originate from the same IP *and* have the same 'field'.
//
// If 'field' is not set, the rate limit will be applied to *all* requests
// originating from a particular IP.
const $createRateLimitMiddleware = (
	rateLimiter: ReturnType<typeof createRateLimiter>,
	{
		ignoreIP = false,
		allowReset = true,
	}: { ignoreIP?: boolean; allowReset?: boolean } = {},
	field?: RateLimitKey,
): RequestHandler => {
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
						captureException(err, 'Error failed to reset rate limit counter', {
							req,
						});
					}
				};
		  };
	return async (req, res, next) => {
		try {
			const key = await keyFn(req, res);
			await rateLimiter.consume(key);
			addReset(req, key);
			next();
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Error during rate limiting', { req });
			res.status(500).end();
		}
	};
};
