import * as Promise from 'bluebird';
import * as avro from 'avsc';
import { EventEmitter } from 'events';
import * as _ from 'lodash';
import * as redis from 'redis';
import {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	LogWriteContext,
	Subscription,
} from '../struct';
import { captureException } from '../../../platform/errors';
import { sbvrUtils } from '../../../platform';
import { REDIS_HOST, REDIS_PORT } from '../../config';

const { ServiceUnavailableError, BadRequestError } = sbvrUtils;

// Expire after 30 days of inactivity
const KEY_EXPIRATION = 30 * 24 * 60 * 60 * 1000;
const VERSION = 1;
const BUFFER_ENCODING = 'binary';

const schema = avro.Type.forSchema({
	name: 'log',
	type: 'record',
	fields: [
		{ name: 'version', type: 'int', default: VERSION },
		{ name: 'createdAt', type: 'long' },
		{ name: 'timestamp', type: 'long' },
		{ name: 'isSystem', type: 'boolean', default: false },
		{ name: 'isStdErr', type: 'boolean', default: false },
		{ name: 'serviceId', type: ['null', 'int'], default: null },
		{ name: 'message', type: 'string' },
	],
});

export interface DeviceLog {
	message: string;
	// These 2 dates are timestamps including milliseconds
	createdAt: number;
	timestamp: number;
	isSystem: boolean;
	isStdErr: boolean;
	serviceId?: number;
}

export class RedisBackend implements DeviceLogsBackend {
	private cmds: redis.RedisClient;
	private pubSub: redis.RedisClient;
	private subscriptions: EventEmitter;

	constructor() {
		this.cmds = this.createClient();
		// This connection goes into "subscriber mode" and cannot be reused for commands
		this.pubSub = this.createClient();
		this.pubSub.on('message', this.handleMessage.bind(this));

		this.subscriptions = new EventEmitter();
	}

	public history(ctx: LogContext, count: number): Promise<DeviceLog[]> {
		if (!this.connected) {
			return Promise.reject(new ServiceUnavailableError());
		}
		return Promise.fromCallback(callback => {
			const key = this.getKey(ctx);
			this.cmds.lrange(key, 0, -1, callback);
		}).then((payloads: string[]) => {
			return _(payloads)
				// TODO: This slice should be handled in the redis call itself
				.slice(-count)
				.map(this.fromRedisLog)
				.compact()
				.value();
		});
	}

	public get available(): boolean {
		// should_buffer is there but missing from the official typings
		return !this.cmds.should_buffer;
	}

	public publish(ctx: LogWriteContext, logs: DeviceLog[]): Promise<any> {
		if (!this.connected) {
			return Promise.reject(new ServiceUnavailableError());
		}

		const limit = ctx.retention_limit || 0;
		const key = this.getKey(ctx);
		const redisLogs = logs.map(this.toRedisLog, this);
		// Create a Redis transaction
		const tx = this.cmds.multi();
		// Add the logs to the List structure
		tx.rpush(key, redisLogs);
		// Trim it to the retention limit
		tx.ltrim(key, -limit, -1);
		// Publish each log using Redis PubSub
		for (const rLog of redisLogs) {
			tx.publish(key, rLog);
		}
		// Devices with no new logs eventually expire
		tx.pexpire(key, KEY_EXPIRATION);
		return Promise.fromCallback(callback => {
			tx.exec(callback);
		});
	}

	public subscribe(ctx: LogContext, subscription: Subscription) {
		if (!this.connected) {
			return;
		}
		const key = this.getKey(ctx);
		if (!this.subscriptions.listenerCount(key)) {
			this.pubSub.subscribe(key);
		}
		this.subscriptions.on(key, subscription);
	}

	public unsubscribe(ctx: LogContext, subscription: Subscription) {
		const key = this.getKey(ctx);
		this.subscriptions.removeListener(key, subscription);
		if (!this.subscriptions.listenerCount(key)) {
			this.pubSub.unsubscribe(key);
		}
	}

	private createClient() {
		const client = redis.createClient({
			host: REDIS_HOST,
			port: REDIS_PORT,
			retry_strategy: () => 500,
			enable_offline_queue: false,
		});
		// If not handled will crash the process
		client.on(
			'error',
			_.throttle((err: Error) => {
				captureException(err, 'Redis error');
			}, 300e3),
		);
		return client;
	}

	private get connected() {
		return this.cmds.connected && this.pubSub.connected;
	}

	private getKey(ctx: LogContext) {
		return `device:${ctx.id}:logs`;
	}

	private handleMessage(key: string, payload: string) {
		const log = this.fromRedisLog(payload);
		if (log) {
			this.subscriptions.emit(key, log);
		}
	}

	private fromRedisLog(payload: string): DeviceLog | undefined {
		try {
			const log = schema.fromBuffer(Buffer.from(payload, BUFFER_ENCODING));
			if (log.version !== VERSION) {
				throw new Error(
					`Invalid Redis serialization version: ${JSON.stringify(log)}`,
				);
			}
			if (log.serviceId === null) {
				delete log.serviceId;
			}
			delete log.version;
			return log as DeviceLog;
		} catch (err) {
			captureException(err, `Failed to deserialize a Redis log: ${payload}`);
			return;
		}
	}

	private toRedisLog(log: DeviceLog): string {
		try {
			return schema.toBuffer(log).toString(BUFFER_ENCODING);
		} catch (err) {
			// Rethrow with a type of error that will end up as status 400
			throw new BadRequestError(err);
		}
	}
}
