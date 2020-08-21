import { isMaster } from 'cluster';
import type { Request, Response, RequestHandler } from 'express';
import * as _ from 'lodash';
import {
	IRateLimiterOptions,
	RateLimiterAbstract,
	RateLimiterCluster,
	RateLimiterMemory,
	RateLimiterRedis,
	RateLimiterRes,
} from 'rate-limiter-flexible';
import * as redis from 'redis';

import { captureException } from '../error-handling';

import {
	RATE_LIMIT_FACTOR,
	RATE_LIMIT_MEMORY_BACKEND,
	REDIS_HOST,
	REDIS_PORT,
} from '../../lib/config';

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
const redisRetryStrategy: redis.RetryStrategy = _.constant(200);

// Use redis as a store.
const getStore = (opts: IRateLimiterOptions) => {
	let insuranceLimiter;
	if (isMaster) {
		insuranceLimiter = new RateLimiterMemory({
			...opts,
			keyPrefix: 'api:ratelimiting:memory',
		});
	} else {
		insuranceLimiter = new RateLimiterCluster({
			...opts,
			keyPrefix: 'api:ratelimiting:cluster',
			timeoutMs: 3000, // Promise is rejected, if master doesn't answer for 3 secs
		});
	}

	if (RATE_LIMIT_MEMORY_BACKEND != null) {
		return insuranceLimiter;
	}

	const client = redis.createClient({
		host: REDIS_HOST,
		port: REDIS_PORT,
		retry_strategy: redisRetryStrategy,
		enable_offline_queue: false,
	});

	// we need to bind to this error handler otherwise a redis error would kill
	// the whole process
	client.on('error', _.throttle(logRedisError, 300000));

	return new RateLimiterRedis({
		...opts,
		keyPrefix: 'api:ratelimiting:redis:',
		storeClient: client,
		insuranceLimiter,
	});
};

export const getUserIDFromCreds = (req: Request): string => {
	if (req.creds != null && 'id' in req.creds) {
		return `userID:${req.creds.id}`;
	}
	return `nouserID`;
};

export type PartialRateLimitMiddleware = (
	field?: string | ((req: Request, res: Response) => string),
) => RequestHandler;

export const createRateLimitMiddleware = (
	opts: IRateLimiterOptions,
	keyOpts: Parameters<typeof $createRateLimitMiddleware>[1] = {},
): PartialRateLimitMiddleware => {
	if (opts.points != null) {
		opts.points *= RATE_LIMIT_FACTOR;
	}
	const store = getStore(opts);

	return _.partial($createRateLimitMiddleware, store, keyOpts);
};

// If 'field' is set, the middleware will apply the rate limit to requests
// that originate from the same IP *and* have the same 'field'.
//
// If 'field' is not set, the rate limit will be applied to *all* requests
// originating from a particular IP.
const $createRateLimitMiddleware = (
	rateLimiter: RateLimiterAbstract,
	{
		ignoreIP = false,
		allowReset = true,
	}: { ignoreIP?: boolean; allowReset?: boolean } = {},
	field?: string | ((req: Request, res: Response) => string),
): RequestHandler => {
	let fieldFn: (req: Request, res: Response) => string;
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
	let keyFn: (req: Request, res: Response) => string;
	if (ignoreIP) {
		keyFn = fieldFn;
	} else {
		keyFn = (req, res) => req.ip + '$' + fieldFn(req, res);
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
			const key = keyFn(req, res);
			await rateLimiter.consume(key);
			addReset(req, key);
			next();
		} catch (e) {
			if (e instanceof RateLimiterRes) {
				if (e.msBeforeNext) {
					res.set('Retry-After', `${Math.round(e.msBeforeNext / 1000)}`);
				}
				res.status(429).send('Too Many Requests');
			} else {
				captureException(e, 'Error during rate limiting', { req });
				res.sendStatus(500);
			}
		}
	};
};
