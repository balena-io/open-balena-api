/*
	Redis Queue Library

	A minimal delayed message queue that replaces RSMQ, using the shared node-redis client so that it
	also works with a redis cluster.

	The data layout is compatible with RSMQ so that both can operate on the same queue, eg during a
	rolling upgrade:
		- `${key}` is a sorted set of message ids, scored by the timestamp (ms) they become visible
		- `${key}:Q` is a hash of message id to message body, along with the `totalsent`/`totalrecv` stats

	When using a redis cluster both keys must be in the same hash slot, so `key` must contain a hash
	tag, eg `my-namespace:{my-queue}`.

	All timestamps are taken from the redis server time, so that they are consistent across consumers.
*/

import randomstring from 'randomstring';
import type { redis } from '../redis/index.ts';

export interface QueueMessage {
	id: string;
	message: string;
}

export interface QueueAttributes {
	totalsent: number;
	totalrecv: number;
	/** The total number of messages in the queue */
	msgs: number;
	/** The number of messages that are not visible yet, either due to a delay or being received */
	hiddenmsgs: number;
}

const nowMsLua = `
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;

const sendScript = `${nowMsLua}
redis.call("ZADD", KEYS[1], now + tonumber(ARGV[2]) * 1000, ARGV[1])
redis.call("HSET", KEYS[2], ARGV[1], ARGV[3])
redis.call("HINCRBY", KEYS[2], "totalsent", 1)
`;

const receiveScript = `${nowMsLua}
local ids = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", now, "LIMIT", 0, 1)
if #ids == 0 then
	return false
end
local id = ids[1]
local message = redis.call("HGET", KEYS[2], id)
if not message then
	-- Remove orphaned ids so that they do not get stuck in the queue
	redis.call("ZREM", KEYS[1], id)
	return false
end
-- Hide the message for the visibility timeout, so that other consumers will not receive it
redis.call("ZADD", KEYS[1], now + tonumber(ARGV[1]) * 1000, id)
redis.call("HINCRBY", KEYS[2], "totalrecv", 1)
return { id, message }
`;

const deleteScript = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
-- The :rc/:fr fields are only set by RSMQ, but we still clean them up for compatibility
redis.call("HDEL", KEYS[2], ARGV[1], ARGV[1] .. ":rc", ARGV[1] .. ":fr")
return removed
`;

const attributesScript = `${nowMsLua}
local stats = redis.call("HMGET", KEYS[2], "totalsent", "totalrecv")
return {
	tonumber(stats[1]) or 0,
	tonumber(stats[2]) or 0,
	redis.call("ZCARD", KEYS[1]),
	redis.call("ZCOUNT", KEYS[1], "(" .. now, "+inf"),
}
`;

/**
 * Generates an RSMQ compatible id (32 alphanumeric chars), prefixed with the time so that
 * messages that become visible at the same time are received in the order they were sent
 */
const generateId = () =>
	(Date.now() * 1000).toString(36).padStart(10, '0') +
	randomstring.generate(22);

export const createRedisQueue = (client: typeof redis, key: string) => {
	const keys = [key, `${key}:Q`];

	return {
		/**
		 * Adds a message to the queue that will become visible after `delay` seconds
		 * @returns The id of the message
		 */
		sendMessage: async (message: string, delay = 0): Promise<string> => {
			const id = generateId();
			await client.eval(sendScript, {
				keys,
				arguments: [id, `${delay}`, message],
			});
			return id;
		},
		/**
		 * Receives the next visible message, if any, and hides it for `visibilityTimeout` seconds.
		 * The message must be deleted once processed, otherwise it will be received again after the timeout
		 */
		receiveMessage: async (
			visibilityTimeout: number,
		): Promise<QueueMessage | undefined> => {
			const result = (await client.eval(receiveScript, {
				keys,
				arguments: [`${visibilityTimeout}`],
			})) as [string, string] | null;
			if (result == null) {
				return;
			}
			const [id, message] = result;
			return { id, message };
		},
		/**
		 * @returns Whether the message existed
		 */
		deleteMessage: async (id: string): Promise<boolean> => {
			const removed = await client.eval(deleteScript, {
				keys,
				arguments: [id],
			});
			return removed === 1;
		},
		getQueueAttributes: async (): Promise<QueueAttributes> => {
			const [totalsent, totalrecv, msgs, hiddenmsgs] = (await client.eval(
				attributesScript,
				{ keys },
			)) as [number, number, number, number];
			return { totalsent, totalrecv, msgs, hiddenmsgs };
		},
	};
};

export type RedisQueue = ReturnType<typeof createRedisQueue>;
