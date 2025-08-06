import avro from 'avsc';
import { stripIndent } from 'common-tags';
import { EventEmitter } from 'events';
import _ from 'lodash';
import { errors } from '@balena/pinejs';
import { captureException } from '../../../../infra/error-handling/index.js';
import {
	LOGS_DEFAULT_RETENTION_DURATION,
	LOGS_SUBSCRIPTION_EXPIRY_HEARTBEAT_SECONDS,
	LOGS_SUBSCRIPTION_EXPIRY_SECONDS,
	REDIS_LOGS_COMPRESSION_ENABLED,
	REDIS_LOGS_SHARDED_PUBSUB,
} from '../../../../lib/config.js';
import type {
	DeviceLogsBackend,
	HistoryOpts,
	InternalDeviceLog,
	LogContext,
	OutputDeviceLog,
	Subscription,
} from '../struct.js';
import {
	newNodeRedisSubscribeInstance,
	createIsolatedRedis,
} from '../../../../infra/redis/index.js';
import type { Result } from 'ioredis';

const SUBSCRIBECMD = REDIS_LOGS_SHARDED_PUBSUB ? 'sSubscribe' : 'subscribe';
const UNSUBSCRIBECMD = REDIS_LOGS_SHARDED_PUBSUB
	? 'sUnsubscribe'
	: 'unsubscribe';
const PUBLISHCMD = REDIS_LOGS_SHARDED_PUBSUB ? 'spublish' : 'publish';

const redis = createIsolatedRedis({ instance: 'logs' });
const redisRO = createIsolatedRedis({ instance: 'logs', readOnly: true });

const { ServiceUnavailableError, BadRequestError } = errors;

const KEY_EXPIRATION = LOGS_DEFAULT_RETENTION_DURATION;
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

interface RedisDeviceLog extends OutputDeviceLog {
	version: number;
}

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
const pubSub = await newNodeRedisSubscribeInstance({ instance: 'logs' });

const getCompressionLib = _.once(async () => {
	if (!REDIS_LOGS_COMPRESSION_ENABLED) {
		return;
	}
	// FIXME: Importing 'snappy' statically at the top level causes some balenaMachine installations to take
	// a long time to startup or enter a restart loop. This might be due to 'spappy' being composed of
	// a big Rust compiled package (making it one big & slow to import file), and having native sub-dependencies
	// '@napi-rs/snappy-xyz' (potential arch/lib incompatibilities). Importing the module lazily or disabling
	// compression with REDIS_LOGS_COMPRESSION_ENABLED seems to workaround the issue in such cases.
	const snappy = await import('snappy');
	return {
		compress: snappy.compress,
		uncompress: async (buffer: Buffer) =>
			(await snappy.uncompress(buffer)) as Buffer,
	};
});

export class RedisBackend implements DeviceLogsBackend {
	private subscriptions: EventEmitter;
	private subscriptionHeartbeats: {
		[key: string]: ReturnType<typeof setInterval>;
	} = {};

	constructor() {
		this.subscriptions = new EventEmitter();
	}

	public async history(
		ctx: LogContext,
		{ count, start }: HistoryOpts,
	): Promise<OutputDeviceLog[]> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		const key = this.getKey(ctx);
		const payloads = await redisRO.lrange(
			key,
			count === Infinity ? 0 : -count,
			-1,
		);
		return (await Promise.all(payloads.map(this.fromRedisLog))).filter(
			(log): log is NonNullable<typeof log> => {
				if (log == null) {
					return false;
				}
				if (start == null) {
					return true;
				}
				return log.createdAt >= start;
			},
		);
	}

	public get available(): boolean {
		return this.connected;
	}

	public async publish(
		ctx: LogContext,
		logs: InternalDeviceLog[],
	): Promise<void> {
		if (!this.connected) {
			throw new ServiceUnavailableError();
		}
		// Immediately map the logs as they are synchronously cleared
		const redisLogs = await Promise.all(logs.map(this.toRedisLog, this));

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
			void pubSub[SUBSCRIBECMD](key, this.handleMessage);
			// Increment the subscribers counter to recognize we've subscribed
			void redis.incrSubscribers(subscribersKey);
			// Start a heartbeat to ensure the subscribers counter stays alive whilst we're subscribed
			this.subscriptionHeartbeats[key] = setInterval(() => {
				void redis.expire(subscribersKey, LOGS_SUBSCRIPTION_EXPIRY_SECONDS);
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
			delete this.subscriptionHeartbeats[key];
			// And decrement the subscribers counter
			void redis.decrSubscribers(subscribersKey).then((n) => {
				if (n < 0) {
					captureException(
						new Error(),
						`Decremented logs subscribers below 0, n: '${n}', uuid: '${ctx.uuid}'`,
					);
				}
			});
			void pubSub[UNSUBSCRIBECMD](key);
		}
	}

	private get connected() {
		return (
			redis.status === 'ready' && pubSub.isOpen && redisRO.status === 'ready'
		);
	}

	private getKey(ctx: LogContext, suffix = 'logs') {
		return `{device:${ctx.id}}:${suffix}`;
	}

	private handleMessage = async (payload: string, key: string) => {
		const log = await this.fromRedisLog(payload);
		if (log) {
			this.subscriptions.emit(key, log);
		}
	};

	private async fromRedisLog(
		payload: string,
	): Promise<RedisDeviceLog | undefined> {
		try {
			let decompressedBuffer: Buffer = Buffer.from(payload, BUFFER_ENCODING);
			const compression = await getCompressionLib();
			if (compression != null) {
				try {
					decompressedBuffer = await compression.uncompress(decompressedBuffer);
				} catch {
					// We ignore ones that fail to decompress as they are likely from before we added compression
					// TODO: Stop ignoring these errors once we're sure all logs are compressed
				}
			}
			const log = schema.fromBuffer(decompressedBuffer);
			if (log.version !== VERSION) {
				throw new Error(
					`Invalid Redis serialization version: ${JSON.stringify(log)}`,
				);
			}
			if (log.serviceId === null) {
				delete log.serviceId;
			}
			delete log.version;
			return log as RedisDeviceLog;
		} catch (err) {
			captureException(err, `Failed to deserialize a Redis log: ${payload}`);
		}
	}

	private async toRedisLog(log: InternalDeviceLog): Promise<string> {
		try {
			let compressedLog = schema.toBuffer({
				...log,
				createdAt: Math.floor(Number(log.nanoTimestamp / 1000000n)),
			});
			const compression = await getCompressionLib();
			if (compression != null) {
				compressedLog = await compression.compress(compressedLog);
			}
			return compressedLog.toString(BUFFER_ENCODING);
		} catch (err) {
			captureException(err, 'Failed to convert log to redis buffer');
			throw new BadRequestError();
		}
	}
}
