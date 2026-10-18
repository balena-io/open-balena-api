import _ from 'lodash';
import { EventEmitter } from 'events';
import { errors, sbvrUtils, permissions } from '@balena/pinejs';
import {
	LOKI_QUERY_HOST,
	LOKI_QUERY_HTTP_PORT,
	LOKI_HISTORY_GZIP,
	LOKI_RETRIES_ENABLED,
	LOKI_PUSH_PROTOCOL,
	LOKI_PUSH_TIMEOUT,
	LOKI_HISTORY_TIMEOUT,
} from '../../../../lib/config.ts';
import type {
	DeviceLogsBackend,
	HistoryOpts,
	InternalDeviceLog,
	LogContext,
	LokiLogContext,
	OutputDeviceLog,
	Subscription,
} from '../struct.ts';
import { captureException } from '../../../../infra/error-handling/index.ts';
import {
	decrementSubscription,
	incrementSubscription,
	incrementPublishCallSuccessTotal,
	incrementPublishCallFailedTotal,
	incrementLokiPushErrorTotal,
	incrementPublishLogMessagesTotal,
	incrementPublishLogMessagesDropped,
	incrementLokiPushTotal,
	updateLokiPushDurationHistogram,
	incrementPublishCallTotal,
} from './metrics.ts';
import { setTimeout } from 'timers/promises';
import { requestAsync } from '../../../../infra/request-promise/index.ts';
import WebSocket from 'ws';
import querystring from 'node:querystring';
import type {
	LokiEntry,
	LokiLabelPair,
	LokiStream,
} from './loki-push-request.ts';
import type { LokiPusher } from './loki-pushers.ts';
import { createGrpcPusher, createHttpPusher } from './loki-pushers.ts';

const { BadRequestError } = errors;

interface LokiDeviceLog extends Omit<InternalDeviceLog, 'nanoTimestamp'> {
	version?: number;
	createdAt?: number;
}

const lokiQueryAddress = `${LOKI_QUERY_HOST}:${LOKI_QUERY_HTTP_PORT}`;

const MIN_BACKOFF = 100;
const MAX_BACKOFF = 10 * 1000;
const VERSION = 2;

function backoff<T extends (...args: any[]) => any>(
	fn: T,
	retryIf: (err: Error) => boolean,
) {
	return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
		let nextBackoff = MIN_BACKOFF;
		let prevBackoff = MIN_BACKOFF;
		while (nextBackoff <= MAX_BACKOFF) {
			try {
				return await fn(...args);
			} catch (err) {
				if (retryIf(err)) {
					await setTimeout(nextBackoff);
					// fibonacci
					nextBackoff = nextBackoff + prevBackoff;
					prevBackoff = nextBackoff - prevBackoff;
				} else {
					throw err;
				}
			}
		}
		throw Error(`Backoff exceeded`);
	};
}

const $getLokiContext = _.once(() =>
	sbvrUtils.api.resin.prepare(
		{
			resource: 'application',
			passthrough: { req: permissions.rootRead },
			options: {
				$select: ['id', 'organization'],
				$filter: {
					owns__device: {
						$any: {
							$alias: 'd',
							$expr: { d: { id: { '@': 'id' } } },
						},
					},
				},
			},
		},
		{ id: ['number'] },
	),
);

export class LokiBackend implements DeviceLogsBackend {
	private subscriptions: EventEmitter;
	private pusher: LokiPusher;
	private tailCalls: Map<string, WebSocket>;

	constructor({
		pusher = LOKI_PUSH_PROTOCOL === 'http'
			? createHttpPusher()
			: createGrpcPusher(),
	}: { pusher?: LokiPusher } = {}) {
		this.subscriptions = new EventEmitter();
		this.pusher = pusher;
		this.tailCalls = new Map();
		this.push = backoff(this.push.bind(this), (err): boolean => {
			incrementLokiPushErrorTotal(this.pusher.errorLabel(err));
			return LOKI_RETRIES_ENABLED && this.pusher.isRetryable(err);
		});
	}

	public readonly available = true;

	/**
	 *
	 * Return $count of logs matching device_id in ascending order.
	 *
	 * The logs are sorted by timestamp since Loki returns a distinct stream for each label combination.
	 *
	 * @param ctx
	 * @param count
	 */
	public async history(
		ctx: LokiLogContext,
		{ count, start }: HistoryOpts,
	): Promise<OutputDeviceLog[]> {
		const [{ statusCode }, body] = await requestAsync({
			url: `http://${lokiQueryAddress}/loki/api/v1/query_range`,
			headers: { 'X-Scope-OrgID': ctx.orgId },
			qs: {
				query: this.getDeviceQuery(ctx),
				limit: Number.isFinite(count) ? count : 1000,
				start: `${BigInt(start) * 1000000n}`,
			},
			timeout: LOKI_HISTORY_TIMEOUT,
			json: true,
			gzip: LOKI_HISTORY_GZIP,
		});

		if (statusCode !== 200) {
			throw new Error(
				`Failed to fetch loki history, statusCode=${statusCode}, body=${body}`,
			);
		}

		return _(
			body.data.result as Array<{
				values: Array<[timestamp: string, logLine: string]>;
			}>,
		)
			.flatMap(({ values }) => values)
			.map(([timestamp, logLine]): [bigint, OutputDeviceLog] => {
				const log: LokiDeviceLog = JSON.parse(logLine);
				if (log.version !== VERSION) {
					throw new Error(
						`Invalid Loki serialization version: ${JSON.stringify(log)}`,
					);
				}
				delete log.version;
				const nanoTimestamp = BigInt(timestamp);
				log.createdAt = Math.floor(Number(nanoTimestamp / 1000000n));
				return [nanoTimestamp, log as OutputDeviceLog];
			})
			.sortBy(([timestamp]) => timestamp)
			.map(([, log]) => log)
			.value();
	}

	public async publish(
		ctx: LokiLogContext,
		logs: Array<InternalDeviceLog & { version?: number }>,
	): Promise<any> {
		const logEntries = this.fromDeviceLogsToEntries(ctx, logs);

		const countLogs = logs.length;
		incrementPublishCallTotal();
		incrementPublishLogMessagesTotal(countLogs);
		const stream = this.fromLogEntriesToStream(ctx, logEntries);
		try {
			await this.push(ctx, stream);
			incrementPublishCallSuccessTotal();
		} catch (err) {
			incrementPublishCallFailedTotal();
			incrementPublishLogMessagesDropped(countLogs);
			if (err.code !== 429) {
				// Don't capture 429 errors as they are expected during rate limiting
				captureException(err, `Failed to publish logs for device ${ctx.uuid}`);
			}
			throw new BadRequestError(
				`Failed to publish logs for device ${ctx.uuid}`,
			);
		}
	}

	private async push(ctx: LokiLogContext, stream: LokiStream): Promise<void> {
		incrementLokiPushTotal();
		const startAt = Date.now();
		try {
			await this.pusher.push(ctx.orgId, [stream], startAt + LOKI_PUSH_TIMEOUT);
		} finally {
			updateLokiPushDurationHistogram(Date.now() - startAt);
		}
	}

	private createTailCall(ctx: LokiLogContext, key: string) {
		if (!this.tailCalls.has(key)) {
			let ws: WebSocket | undefined = new WebSocket(
				`ws://${lokiQueryAddress}/loki/api/v1/tail?${querystring.stringify({
					query: this.getDeviceQuery(ctx),
					start: `${BigInt(Date.now()) * 1000000n}`,
				})}`,
				{ headers: { 'X-Scope-OrgID': ctx.orgId } },
			);
			this.tailCalls.set(key, ws);

			const reconnect = () => {
				if (ws == null) {
					return;
				}
				ws.removeAllListeners();
				if (this.tailCalls.get(key) === ws) {
					// Only clean up/reconnect if the current tailCall matches
					this.tailCalls.delete(key);
					if (this.subscriptions.listenerCount(key) > 0) {
						// If there are still listeners, recreate the tail call
						this.createTailCall(ctx, key);
					}
				}
				ws = undefined;
			};

			ws.on('error', (err) => {
				captureException(
					err,
					`Loki tail call message error for device ${ctx.uuid}`,
				);
				reconnect();
			});
			ws.on('close', reconnect);

			ws.on('message', (data) => {
				try {
					const result = JSON.parse(data.toString()) as {
						streams: Array<{
							stream: Record<string, string>;
							values: Array<[timestamp: string, logLine: string]>;
						}>;
					};

					for (const stream of result.streams) {
						// TODO: if there are multiple streams we may have to buffer the logs and sort them by timestamp
						for (const [timestamp, logLine] of stream.values) {
							const log: LokiDeviceLog = JSON.parse(logLine);
							if (log.version !== VERSION) {
								throw new Error(
									`Invalid Loki serialization version: ${JSON.stringify(log)}`,
								);
							}
							delete log.version;
							const nanoTimestamp = BigInt(timestamp);
							log.createdAt = Math.floor(Number(nanoTimestamp / 1000000n));
							this.subscriptions.emit(key, log);
						}
					}
				} catch (err) {
					captureException(
						err,
						`Loki tail call message error for device ${ctx.uuid}`,
					);
				}
			});
		}
	}

	public subscribe(ctx: LokiLogContext, subscription: Subscription) {
		const key = this.getKey(ctx);
		this.createTailCall(ctx, key);

		this.subscriptions.on(key, subscription);
		incrementSubscription();
	}

	public unsubscribe(ctx: LokiLogContext, subscription: Subscription) {
		const key = this.getKey(ctx);
		this.subscriptions.removeListener(key, subscription);
		decrementSubscription();

		if (!this.subscriptions.listenerCount(key)) {
			const call = this.tailCalls.get(key);
			if (call != null) {
				this.tailCalls.delete(key);
				call.close();
			}
		}
	}

	private getDeviceQuery(ctx: LokiLogContext) {
		return `{fleet_id="${ctx.appId}"} | device_id="${ctx.id}"`;
	}

	private getKey(ctx: LokiLogContext) {
		return `o${ctx.orgId}:a${ctx.appId}:d${ctx.id}`;
	}

	private getStructuredMetadata(ctx: LogContext): LokiLabelPair[] {
		return [{ name: 'device_id', value: `${ctx.id}` }];
	}

	private getLabels(ctx: LokiLogContext): string {
		return `{fleet_id="${ctx.appId}"}`;
	}

	private fromDeviceLogsToEntries(
		ctx: LogContext,
		logs: Array<InternalDeviceLog & { version?: number }>,
	): LokiEntry[] {
		const structuredMetadata = this.getStructuredMetadata(ctx);
		return logs.map((log) => {
			// Strip nanoTimestamp from the log as it cannot be serialized, and avoid a replacer lets us stay on the stringify fast path
			const { nanoTimestamp, ...jsonableLog } = log;
			jsonableLog.version = VERSION;
			return {
				seconds: Math.floor(Number(log.nanoTimestamp / 1000000000n)),
				nanos: Number(log.nanoTimestamp % 1000000000n),
				line: JSON.stringify(jsonableLog),
				structuredMetadata,
			};
		});
	}
	private fromLogEntriesToStream(
		ctx: LokiLogContext,
		logEntries: LokiEntry[],
	): LokiStream {
		return { labels: this.getLabels(ctx), entries: logEntries };
	}

	async addAdditionalContext(
		ctx: Writable<LogContext & Partial<LokiLogContext>>,
	): Promise<void> {
		const [app] = await $getLokiContext()({ id: ctx.id });
		if (app == null) {
			throw new Error(`Device '${ctx.id}' app not found`);
		}
		ctx.appId = `${app.id}`;
		ctx.orgId = `${app.organization.__id}`;
	}
}
