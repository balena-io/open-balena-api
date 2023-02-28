import avro from 'avsc';
import { stripIndent } from 'common-tags';
import { EventEmitter } from 'events';
import _ from 'lodash';
import { errors } from '@balena/pinejs';
import { captureException } from '../../../../infra/error-handling';
import {
	LOGS_SUBSCRIPTION_EXPIRY_HEARTBEAT_SECONDS,
	LOGS_SUBSCRIPTION_EXPIRY_SECONDS,
	REDIS_LOGS_SHARDED_PUBSUB,
} from '../../../../lib/config';
import { DAYS } from '@balena/env-parsing';
import type {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	Subscription,
} from '../struct';
import {
	newSubscribeInstance,
	createIsolatedRedis,
} from '../../../../infra/redis';
import { Result } from 'ioredis';

const SUBSCRIBECMD = REDIS_LOGS_SHARDED_PUBSUB ? 'ssubscribe' : 'subscribe';
const UNSUBSCRIBECMD = REDIS_LOGS_SHARDED_PUBSUB
	? 'sunsubscribe'
	: 'unsubscribe';
const PUBLISHCMD = REDIS_LOGS_SHARDED_PUBSUB ? 'spublish' : 'publish';
const MESSAGECMD = REDIS_LOGS_SHARDED_PUBSUB ? 'smessage' : 'message';

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
	interface RedisCommander<Context> {
		publishLogs(
			logsKey: string,
			bytesWrittenKey: string,
			subscribersKey: string,
			...args: [...logs: string[], bytesWritten: number, limit: number]
		): Result<void, Context>;
		incrSubscribers(subscribersKey: string): Result<void, Context>;
		decrSubscribers(subscribersKey: string): Result<number, Context>;
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
		local subCount = redis.call("get", KEYS[3])
		if subCount ~= false then
			-- Check there are active subscribers before publishing logs using Redis PubSub, avoiding wasted work
			-- We know that if the key is false (doesn't exist) then there are no subscribers as it is cleared upon reaching 0
			for i = 1, #ARGV do
				redis.call("${PUBLISHCMD}", KEYS[1], ARGV[i]);
			end
		end
		-- Increment log bytes written total
		redis.call("incrby", KEYS[2], bytesWritten);
		-- Devices with no new logs eventually expire
		redis.call("pexpire", KEYS[1], ${KEY_EXPIRATION});
		redis.call("pexpire", KEYS[2], ${KEY_EXPIRATION});`,
	numberOfKeys: 3,
});

redis.defineCommand('incrSubscribers', {
	lua: stripIndent`
		-- Increment subscribers
		redis.call("incr", KEYS[1]);
		-- And set expiry
		redis.call("expire", KEYS[1], ${LOGS_SUBSCRIPTION_EXPIRY_SECONDS})`,
	numberOfKeys: 1,
});
redis.defineCommand('decrSubscribers', {
	lua: stripIndent`
		-- Decrement subscribers
		local current = redis.call("decr", KEYS[1]);
		if current <= 0 then
			-- If we were the last subscriber then remove the key altogether
			-- this also handles the symptoms in the potential case where we
			-- decrement below 0, albeit not the cause
			redis.call("del", KEYS[1]);
		end
		-- Return the count so it's possible to log hitting < 0
		return current`,
	numberOfKeys: 1,
});

// This connection goes into "subscriber mode" and cannot be reused for commands
const pubSub = newSubscribeInstance({ instance: 'logs' });

export class RedisBackend implements DeviceLogsBackend {
	private subscriptions: EventEmitter;
	private subscriptionHeartbeats: {
		[key: string]: ReturnType<typeof setInterval>;
	} = {};

	constructor() {
		pubSub.on(MESSAGECMD, this.handleMessage.bind(this));

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

	public async publish(ctx: LogContext, logs: DeviceLog[]): Promise<void> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		// Immediately map the logs as they are synchronously cleared
		const redisLogs = logs.map(this.toRedisLog, this);

		const limit = ctx.retention_limit;
		const key = this.getKey(ctx);
		const bytesWrittenKey = this.getKey(ctx, 'logBytesWritten');
		const subscribersKey = this.getKey(ctx, 'subscribers');

		let bytesWritten = 0;
		for (const rLog of redisLogs) {
			bytesWritten += rLog.length;
		}

		await redis.publishLogs(
			key,
			bytesWrittenKey,
			subscribersKey,
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
			const subscribersKey = this.getKey(ctx, 'subscribers');
			pubSub[SUBSCRIBECMD](key);
			// Increment the subscribers counter to recognize we've subscribed
			redis.incrSubscribers(subscribersKey);
			// Start a heartbeat to ensure the subscribers counter stays alive whilst we're subscribed
			this.subscriptionHeartbeats[key] = setInterval(() => {
				redis.expire(subscribersKey, LOGS_SUBSCRIPTION_EXPIRY_SECONDS);
			}, LOGS_SUBSCRIPTION_EXPIRY_HEARTBEAT_SECONDS);
		}
		this.subscriptions.on(key, subscription);
	}

	public unsubscribe(ctx: LogContext, subscription: Subscription) {
		const key = this.getKey(ctx);
		this.subscriptions.removeListener(key, subscription);
		if (!this.subscriptions.listenerCount(key)) {
			const subscribersKey = this.getKey(ctx, 'subscribers');
			// Clear the heartbeat
			clearInterval(this.subscriptionHeartbeats[key]);
			// And decrement the subscribers counter
			redis.decrSubscribers(subscribersKey).then((n) => {
				if (n < 0) {
					captureException(
						new Error(),
						`Decremented logs subscribers below 0, n: '${n}', uuid: '${ctx.uuid}'`,
					);
				}
			});
			pubSub[UNSUBSCRIBECMD](key);
		}
	}

	private get connected() {
		return (
			redis.status === 'ready' &&
			pubSub.status === 'ready' &&
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
