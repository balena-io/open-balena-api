import * as ExpressBrute from 'express-brute';
import * as Promise from 'bluebird';
import ExpressBruteRedis = require('express-brute-redis');
import * as _ from 'lodash';
import { captureException } from '../platform/errors';

export interface PromisifiedExpressBruteStore extends ExpressBrute.MemoryStore {
	/**
	 * @summary Gets key value.
	 * @param {string}      key     The key name.
	 */
	getAsync(key: string): Promise<Object>;

	/**
	 * @summary Sets the key value.
	 * @param {string}      key      The name.
	 * @param {string}      value    The value.
	 * @param {number}      lifetime The lifetime.
	 */
	setAsync(key: string, value: string, lifetime: number): Promise<void>;

	/**
	 * @summary Deletes the key.
	 * @param {string}      key      The name.
	 */
	resetAsync(key: string): Promise<void>;
}

// This store implementation tries to talk to redis, in case this fails
// it uses an in memory store implementation as fallback.
export class FacadeStore extends ExpressBrute.MemoryStore {
	private readonly redisStore: PromisifiedExpressBruteStore;
	private readonly inMemStore: PromisifiedExpressBruteStore;

	constructor(redisStore: ExpressBruteRedis) {
		super();
		this.redisStore = Promise.promisifyAll(
			redisStore,
		) as PromisifiedExpressBruteStore;
		this.inMemStore = Promise.promisifyAll(
			new ExpressBrute.MemoryStore(),
		) as PromisifiedExpressBruteStore;
	}

	set(
		key: string,
		value: string,
		lifetime: number,
		callback: (err: Error) => void,
	): void {
		const inMemoryPromise = this.inMemStore
			.setAsync(key, value, lifetime)
			.catch(_.noop);

		const redisPromise = this.redisStore
			.setAsync(key, value, lifetime)
			.tapCatch((err: Error) => {
				captureException(err, 'Redis communication failed!');
			});

		Promise.all([inMemoryPromise, redisPromise]).asCallback(callback);
	}

	get(key: string, callback: (err: Error, data: Object) => void): void {
		this.redisStore
			.getAsync(key)
			.catch((err: Error) => {
				captureException(err, 'Redis communication failed!');
				this.inMemStore.getAsync(key).catchThrow(err);
			})
			.asCallback(callback);
	}

	reset(key: string, callback: (err: Error) => void): void {
		const inMemoryPromise = this.inMemStore.resetAsync(key).catch(_.noop);

		const redisPromise = this.redisStore
			.resetAsync(key)
			.tapCatch((err: Error) => {
				captureException(err, 'Redis communication failed!');
			});

		Promise.all([inMemoryPromise, redisPromise]).asCallback(callback);
	}
}
