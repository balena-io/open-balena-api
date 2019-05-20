import * as _express from 'express';
import * as redis from 'redis';
import ExpressBruteRedis = require('express-brute-redis');
import * as Promise from 'bluebird';

import * as ExpressBrute from 'express-brute';
import * as _ from 'lodash';
import { FacadeStore } from './facade-store';
import { captureException } from '../platform/errors';
import {
	RATE_LIMIT_MEMORY_BACKEND,
	REDIS_HOST,
	REDIS_PORT,
	RATE_LIMIT_FACTOR,
} from './config';

const logRedisError = (err: Error) => {
	// do not log these errors, because this would flood our logs
	// when redis is offline
	// these errors are throttle see below
	captureException(err, 'Error: Redis service communication failed ');
};

interface StoreErrorOptions {
	message: string;
	parent: any;
	next: _express.NextFunction;
}

interface ExpressBruteRedisOpts extends redis.ClientOpts {
	client?: redis.RedisClient;
}

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy: redis.RetryStrategy = _.constant(200);

// Use redis as a store.
const getStore = _.once(() => {
	if (RATE_LIMIT_MEMORY_BACKEND != null) {
		return new ExpressBrute.MemoryStore();
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

	const opts: ExpressBruteRedisOpts = {
		client,
		prefix: 'api:ratelimiting:',
	};

	const redisStore = new ExpressBruteRedis(opts);
	return new FacadeStore(redisStore);
});

// If redis system is not working, we bypass the rate limiting, to not
// block the functionality of the API.
const redisErrorHandler = (options: StoreErrorOptions) => {
	options.next();
};

const failDebug: ExpressBrute.FailTooManyRequests = (
	req,
	res,
	next,
	nextValidRequestDate,
) => {
	console.error('Blocked by rate limiting: ' + req.originalUrl);
	ExpressBrute.FailTooManyRequests(req, res, next, nextValidRequestDate);
};

export const SECONDS = 1000;
export const SECONDS_PER_HOUR = 60 * 60;
export const MINUTES = 60 * SECONDS;
export const HOURS = 60 * MINUTES;

export const getUserIDFromCreds = Promise.method(
	(req: _express.Request): string => {
		if (req.creds != null && 'id' in req.creds) {
			return `userID:${req.creds.id}`;
		}
		return `nouserID`;
	},
);

export const resetCounter = (req: _express.Request): Promise<void> => {
	return Promise.fromCallback<void>(cb => {
		if (req.brute != null) {
			req.brute.reset(cb);
		} else {
			cb(null);
		}
	}).catch((err: Error) => {
		captureException(err, 'Error failed to reset rate limit counter', { req });
	});
};

export function createRateLimit(opts: ExpressBrute.Options): ExpressBrute {
	Object.assign(opts, {
		handleStoreError: redisErrorHandler,
		failCallback: failDebug,
	});
	if (opts.freeRetries !== undefined) {
		opts.freeRetries *= RATE_LIMIT_FACTOR;
	}
	return new ExpressBrute(getStore(), opts);
}

export type PartialRateLimitMiddleware = (
	field?:
		| string
		| ((req: _express.Request, res: _express.Response) => Promise<string>),
) => _express.RequestHandler;

export const createRateLimitMiddleware = (
	expressBrute: ExpressBrute,
	expressBruteMiddleware: Partial<ExpressBrute.Middleware>,
): PartialRateLimitMiddleware => {
	return _.partial(
		$createRateLimitMiddleware,
		expressBrute,
		expressBruteMiddleware,
	);
};

// If 'field' is set, the middleware will apply the rate limit to requests
// that originate from the same IP *and* have the same 'field'.
//
// If 'field' is not set, the rate limit will be applied to *all* requests
// originating from a particular IP.
const $createRateLimitMiddleware = (
	expressBrute: ExpressBrute,
	expressBruteMiddleware: ExpressBrute.Middleware,
	field?:
		| string
		| ((req: _express.Request, res: _express.Response) => Promise<string>),
): _express.RequestHandler => {
	if (expressBrute == null) {
		throw new Error(
			'expressBrute object is required to create rate limit middleware',
		);
	}

	if (field != null) {
		expressBruteMiddleware.key = (
			req: _express.Request,
			res: _express.Response,
			next: _express.NextFunction,
		) => {
			if (_.isFunction(field)) {
				field(req, res)
					.catch(_.noop)
					.then(next);
			} else {
				next(_.get(req, field));
			}
		};
		return expressBrute.getMiddleware(expressBruteMiddleware);
	} else {
		return expressBrute.prevent;
	}
};
