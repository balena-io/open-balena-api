import * as Bluebird from 'bluebird';
import * as _express from 'express';
import ExpressBruteRedis = require('express-brute-redis');
import * as redis from 'redis';

import * as ExpressBrute from 'express-brute';
import * as _ from 'lodash';
import { captureException } from '../platform/errors';
import {
	RATE_LIMIT_FACTOR,
	RATE_LIMIT_MEMORY_BACKEND,
	REDIS_HOST,
	REDIS_PORT,
} from './config';
import { FacadeStore } from './facade-store';

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

export const getUserIDFromCreds = Bluebird.method(
	(req: _express.Request): string => {
		if (req.creds != null && 'id' in req.creds) {
			return `userID:${req.creds.id}`;
		}
		return `nouserID`;
	},
);

export const resetCounter = (req: _express.Request): Bluebird<void> => {
	return Bluebird.fromCallback<void>(cb => {
		if (req.brute != null) {
			req.brute.reset(cb);
		} else {
			cb(null);
		}
	}).catch((err: Error) => {
		captureException(err, 'Error failed to reset rate limit counter', { req });
	});
};

export type PartialRateLimitMiddleware = (
	field?:
		| string
		| ((req: _express.Request, res: _express.Response) => Bluebird<string>),
) => _express.RequestHandler;

export const createRateLimitMiddleware = (
	expressBruteOpts: ExpressBrute.Options,
	expressBruteMiddleware: Partial<ExpressBrute.Middleware> = {},
): PartialRateLimitMiddleware => {
	expressBruteOpts.handleStoreError = redisErrorHandler;
	expressBruteOpts.failCallback = ExpressBrute.FailTooManyRequests;
	if (expressBruteOpts.freeRetries !== undefined) {
		expressBruteOpts.freeRetries *= RATE_LIMIT_FACTOR;
	}
	const expressBrute = new ExpressBrute(getStore(), expressBruteOpts);

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
		| ((req: _express.Request, res: _express.Response) => Bluebird<string>),
): _express.RequestHandler => {
	if (expressBrute == null) {
		throw new Error(
			'expressBrute object is required to create rate limit middleware',
		);
	}

	if (field != null) {
		let keyFn: _express.Handler;
		if (_.isFunction(field)) {
			keyFn = async (req, res, next) => {
				try {
					next(await field(req, res));
				} catch {
					next();
				}
			};
		} else {
			const path = _.toPath(field);
			keyFn = (req, _res, next) => {
				next(_.get(req, path));
			};
		}
		expressBruteMiddleware.key = keyFn;
		return expressBrute.getMiddleware(expressBruteMiddleware);
	} else {
		return expressBrute.prevent;
	}
};
