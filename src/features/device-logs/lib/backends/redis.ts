import * as avro from 'avsc';
import { stripIndent } from 'common-tags';
import { EventEmitter } from 'events';
import * as _ from 'lodash';
import { errors } from '@balena/pinejs';
import { captureException } from '../../../../infra/error-handling';
import { DAYS } from '../../../../lib/config';
import type {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	LogWriteContext,
	Subscription,
} from '../struct';
import {
	newSubscribeInstance,
	createIsolatedRedis,
} from '../../../../infra/redis';

const redis = createIsolatedRedis({ instance: 'logs' });
const redisRO = createIsolatedRedis({ instance: 'logs', readOnly: true });

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

declare module 'ioredis' {
	interface Commands {
		publishLogs(
			logsKey: string,
			bytesWrittenKey: string,
			...args: [...logs: string[], bytesWritten: number, limit: number]
		): Promise<void>;
	}
}

redis.defineCommand('publishLogs', {
	lua: stripIndent`
		-- Last arg should be the retention limit
		local limit = table.remove(ARGV)
		-- Second last arg should be the bytes total
		local bytesWritten = table.remove(ARGV)
		-- Add the logs to the List structure
		redis.call("rpush", KEYS[1], unpack(ARGV))
		-- Trim it to the retention limit
		redis.call("ltrim", KEYS[1], -limit, -1)
		-- Publish each log using Redis PubSub
		for i = 1, #ARGV do
			redis.call("publish", KEYS[1], ARGV[i]);
		end
		-- Increment log bytes written total
		redis.call("incrby", KEYS[2], bytesWritten);
		-- Devices with no new logs eventually expire
		redis.call("pexpire", KEYS[1], ${KEY_EXPIRATION});
		redis.call("pexpire", KEYS[2], ${KEY_EXPIRATION});`,
	numberOfKeys: 2,
});

export class RedisBackend implements DeviceLogsBackend {
	private pubSub: ReturnType<typeof newSubscribeInstance>;
	private subscriptions: EventEmitter;

	constructor() {
		// This connection goes into "subscriber mode" and cannot be reused for commands
		this.pubSub = newSubscribeInstance({ instance: 'logs' });
		this.pubSub.on('message', this.handleMessage.bind(this));

		this.subscriptions = new EventEmitter();
	}

	public async history(ctx: LogContext, count: number): Promise<DeviceLog[]> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		const key = this.getKey(ctx);
		const payloads = await redisRO.lrange(
			key,
			count === Infinity ? 0 : -count,
			-1,
		);
		return _(payloads).map(this.fromRedisLog).compact().value();
	}

	public get available(): boolean {
		return this.connected;
	}

	public async publish(ctx: LogWriteContext, logs: DeviceLog[]): Promise<void> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		// Immediately map the logs as they are synchronously cleared
		const redisLogs = logs.map(this.toRedisLog, this);

		const limit = ctx.retention_limit;
		const key = this.getKey(ctx);
		const bytesWrittenKey = this.getKey(ctx, 'logBytesWritten');

		let bytesWritten = 0;
		for (const rLog of redisLogs) {
			bytesWritten += rLog.length;
		}

		await redis.publishLogs(
			key,
			bytesWrittenKey,
			...redisLogs,
			bytesWritten,
			limit,
		);
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

	private get connected() {
		return (
			redis.status === 'ready' &&
			this.pubSub.status === 'ready' &&
			redisRO.status === 'ready'
		);
	}

	private getKey(ctx: LogContext, suffix = 'logs') {
		return `{device:${ctx.id}}:${suffix}`;
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
