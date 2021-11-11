import * as avro from 'avsc';
import { EventEmitter } from 'events';
import * as _ from 'lodash';
import * as redis from 'redis';
import { errors } from '@balena/pinejs';
import { promisify } from 'util';

import { captureException } from '../../../../infra/error-handling';
import { DAYS, MINUTES, REDIS_HOST, REDIS_PORT } from '../../../../lib/config';
import type {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	LogWriteContext,
	Subscription,
} from '../struct';

// Add promisified methods to the redis prototypes so we don't need to promisify them each time
declare module 'redis' {
	interface RedisClient {
		lrangeAsync(key: string, start: number, stop: number): Promise<string[]>;
	}
	interface Multi {
		execAsync(): Promise<any[]>;
	}
}
redis.RedisClient.prototype.lrangeAsync = promisify(
	redis.RedisClient.prototype.lrange,
);
redis.Multi.prototype.execAsync = promisify(
	redis.Multi.prototype.exec_transaction,
);

const { ServiceUnavailableError, BadRequestError } = errors;

// Expire after 30 days of inactivity
const KEY_EXPIRATION = 30 * DAYS;
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

	public async history(ctx: LogContext, count: number): Promise<DeviceLog[]> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		const key = this.getKey(ctx);
		const payloads = await this.cmds.lrangeAsync(
			key,
			count === Infinity ? 0 : -count,
			-1,
		);
		return _(payloads).map(this.fromRedisLog).compact().value();
	}

	public get available(): boolean {
		// should_buffer is there but missing from the official typings
		return !this.cmds.should_buffer;
	}

	public async publish(ctx: LogWriteContext, logs: DeviceLog[]): Promise<any> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		// Immediately map the logs as they are synchronously cleared
		const redisLogs = logs.map(this.toRedisLog, this);

		const limit = ctx.retention_limit || 0;
		const key = this.getKey(ctx);
		const bytesWrittenKey = this.getKey(ctx, 'logBytesWritten');
		// Create a Redis transaction
		const tx = this.cmds.multi();
		// Add the logs to the List structure
		tx.rpush(key, redisLogs);
		// Trim it to the retention limit
		tx.ltrim(key, -limit, -1);
		// Publish each log using Redis PubSub
		let bytesWritten = 0;
		for (const rLog of redisLogs) {
			tx.publish(key, rLog);
			bytesWritten += rLog.length;
		}
		// Increment log bytes written total
		tx.incrby(bytesWrittenKey, bytesWritten);
		// Devices with no new logs eventually expire
		tx.pexpire(key, KEY_EXPIRATION);
		tx.pexpire(bytesWrittenKey, KEY_EXPIRATION);
		return await tx.execAsync();
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
			}, 5 * MINUTES),
		);
		return client;
	}

	private get connected() {
		return this.cmds.connected && this.pubSub.connected;
	}

	private getKey(ctx: LogContext, suffix = 'logs') {
		return `device:${ctx.id}:${suffix}`;
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
		}
	}

	private toRedisLog(log: DeviceLog): string {
		try {
			return schema.toBuffer(log).toString(BUFFER_ENCODING);
		} catch (err) {
			captureException(err, 'Failed to convert log to redis buffer');
			throw new BadRequestError();
		}
	}
}
