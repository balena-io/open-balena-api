import * as Bluebird from 'bluebird';
import * as Redis from 'redis';

export interface PromisifedRedisClient extends Redis.RedisClient {
	getAsync(key: string): Bluebird<string>;
	setAsync(key: string, value: string): Bluebird<void>;
	setAsync(
		key: string,
		value: string,
		expires: 'EX',
		expiresInSec: number,
	): Bluebird<void>;
	expireAsync(key: string, expries: number): Bluebird<void>;
	[fnName: string]: any;
}

export const createPromisifedRedisClient = (options: Redis.ClientOpts) =>
	Bluebird.promisifyAll(
		new Redis.RedisClient(options),
	) as PromisifedRedisClient;
