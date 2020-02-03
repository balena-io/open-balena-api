import * as Bluebird from 'bluebird';
import * as ExpressBrute from 'express-brute';
import ExpressBruteRedis = require('express-brute-redis');
import * as _ from 'lodash';
import { captureException } from '../platform/errors';

export interface PromisifiedExpressBruteStore extends ExpressBrute.MemoryStore {
	/**
	 * @summary Gets key value.
	 * @param {string}      key     The key name.
	 */
	getAsync(key: string): Bluebird<AnyObject>;

	/**
	 * @summary Sets the key value.
	 * @param {string}      key      The name.
	 * @param {string}      value    The value.
	 * @param {number}      lifetime The lifetime.
	 */
	setAsync(key: string, value: string, lifetime: number): Bluebird<void>;

	/**
	 * @summary Deletes the key.
	 * @param {string}      key      The name.
	 */
	resetAsync(key: string): Bluebird<void>;
}

// This store implementation tries to talk to redis, in case this fails
// it uses an in memory store implementation as fallback.
export class FacadeStore extends ExpressBrute.MemoryStore {
	private readonly redisStore: PromisifiedExpressBruteStore;
	private readonly inMemStore: PromisifiedExpressBruteStore;

	constructor(redisStore: ExpressBruteRedis) {
		super();
		this.redisStore = Bluebird.promisifyAll(
			redisStore,
		) as PromisifiedExpressBruteStore;
		this.inMemStore = Bluebird.promisifyAll(
			new ExpressBrute.MemoryStore(),
		) as PromisifiedExpressBruteStore;
	}

	public set(
		...[key, value, lifetime, callback]: Parameters<
			InstanceType<typeof ExpressBrute.MemoryStore>['set']
		>
	): void {
		const inMemoryPromise = this.inMemStore
			.setAsync(key, value, lifetime)
			.catch(_.noop);

		const redisPromise = this.redisStore
			.setAsync(key, value, lifetime)
			.tapCatch((err: Error) => {
				captureException(err, 'Redis communication failed!');
			});

		Bluebird.all([inMemoryPromise, redisPromise]).asCallback(callback);
	}

	public get(
		...[key, callback]: Parameters<
			InstanceType<typeof ExpressBrute.MemoryStore>['get']
		>
	): void {
		this.redisStore
			.getAsync(key)
			.catch((err: Error) => {
				captureException(err, 'Redis communication failed!');
				this.inMemStore.getAsync(key).catchThrow(err);
			})
			.asCallback(callback);
	}

	public reset(
		...[key, callback]: Parameters<
			InstanceType<typeof ExpressBrute.MemoryStore>['reset']
		>
	): void {
		const inMemoryPromise = this.inMemStore.resetAsync(key).catch(_.noop);

		const redisPromise = this.redisStore
			.resetAsync(key)
			.tapCatch((err: Error) => {
				captureException(err, 'Redis communication failed!');
			});

		Bluebird.all([inMemoryPromise, redisPromise]).asCallback(callback);
	}
}
