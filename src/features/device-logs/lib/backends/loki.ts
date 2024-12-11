import _ from 'lodash';
import { EventEmitter } from 'events';
import { compressionAlgorithms } from '@grpc/grpc-js';

import loki from 'loki-grpc-client';
import type { types } from '@balena/pinejs';
import { errors, sbvrUtils, permissions } from '@balena/pinejs';
import {
	LOKI_QUERY_HOST,
	LOKI_QUERY_HTTP_PORT,
	LOKI_INGESTER_HOST,
	LOKI_INGESTER_GRPC_PORT,
	LOKI_HISTORY_GZIP,
	LOKI_GRPC_SEND_GZIP,
	LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL,
} from '../../../../lib/config.js';
import type {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	LokiLogContext,
	Subscription,
} from '../struct.js';
import { captureException } from '../../../../infra/error-handling/index.js';
import {
	setCurrentSubscriptions,
	incrementSubscriptionTotal,
	incrementPublishCallSuccessTotal,
	incrementPublishCallFailedTotal,
	incrementLokiPushErrorTotal,
	incrementPublishLogMessagesTotal,
	incrementPublishLogMessagesDropped,
	incrementLokiPushTotal,
	updateLokiPushDurationHistogram,
	incrementPublishCallTotal,
} from './metrics.js';
import { setTimeout } from 'timers/promises';
import { omitNanoTimestamp } from '../config.js';
import { requestAsync } from '../../../../infra/request-promise/index.js';

const { BadRequestError } = errors;

// invert status object for quick lookup of status identifier using status code
const statusKeys = _.transform(
	loki.status,
	function (result: Dictionary<string>, value, key) {
		result[value] = key;
	},
	{},
);

const lokiQueryAddress = `${LOKI_QUERY_HOST}:${LOKI_QUERY_HTTP_PORT}`;
const lokiIngesterAddress = `${LOKI_INGESTER_HOST}:${LOKI_INGESTER_GRPC_PORT}`;

// Retries disabled so that writes to Redis are not delayed on Loki error
const RETRIES_ENABLED = false;
// Timeout set to 1s so that writes to Redis are not delayed if Loki is slow
const PUSH_TIMEOUT = 1000;
const MIN_BACKOFF = 100;
const MAX_BACKOFF = 10 * 1000;
const VERSION = 2;
const VERBOSE_ERROR_MESSAGE = false;

function createTimestampFromDate(date = new Date()) {
	const timestamp = new loki.Timestamp();
	timestamp.fromDate(date);
	return timestamp;
}

function backoff<T extends (...args: any[]) => any>(
	fn: T,
	retryIf: (err: Error) => boolean,
) {
	return async (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
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

/**
 * This converts a standard log context to a loki context, if a loki context is the most common
 * then it would make sense to combine this fetch in the initial context fetch but currently that
 * is not the case anywhere
 */
async function assertLokiLogContext(
	ctx: LogContext & Partial<LokiLogContext>,
): Promise<LokiLogContext> {
	if ('belongs_to__application' in ctx) {
		return ctx as types.RequiredField<typeof ctx, 'belongs_to__application'>;
	}

	const device = await sbvrUtils.api.resin.get({
		resource: 'device',
		id: ctx.id,
		passthrough: { req: permissions.root },
		options: {
			$select: ['belongs_to__application'],
		},
	});

	// Mutate so that we don't have to repeatedly amend the same context and instead cache it
	(ctx as Writable<typeof ctx>).belongs_to__application =
		device?.belongs_to__application?.__id;

	return ctx as types.RequiredField<typeof ctx, 'belongs_to__application'>;
}

export class LokiBackend implements DeviceLogsBackend {
	private subscriptions: EventEmitter;
	private querier: loki.QuerierClient;
	private pusher: loki.PusherClient;
	private tailCalls: Map<string, loki.ClientReadableStream<loki.TailResponse>>;

	constructor() {
		this.subscriptions = new EventEmitter();
		const compressionAlgorithm = LOKI_GRPC_SEND_GZIP
			? compressionAlgorithms.gzip
			: compressionAlgorithms.identity;
		this.querier = new loki.QuerierClient(
			lokiIngesterAddress,
			loki.createInsecureCredentials(),
			{
				'grpc.default_compression_algorithm': compressionAlgorithm,
				'grpc.default_compression_level': LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL,
			},
		);
		this.pusher = new loki.PusherClient(
			lokiIngesterAddress,
			loki.createInsecureCredentials(),
			{
				'grpc.default_compression_algorithm': compressionAlgorithm,
				'grpc.default_compression_level': LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL,
			},
		);
		this.tailCalls = new Map();
		this.push = backoff(
			this.push.bind(this),
			(err: loki.ServiceError): boolean => {
				incrementLokiPushErrorTotal(
					err.code ? statusKeys[err.code] : 'UNDEFINED',
				);
				return (
					RETRIES_ENABLED &&
					[loki.status.UNAVAILABLE, loki.status.RESOURCE_EXHAUSTED].includes(
						err.code ?? -1,
					)
				);
			},
		);
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
	public async history($ctx: LogContext, count: number): Promise<DeviceLog[]> {
		const ctx = await assertLokiLogContext($ctx);

		const [, body] = await requestAsync({
			url: `http://${lokiQueryAddress}/loki/api/v1/query_range`,
			headers: {
				'X-Scope-OrgID': `${ctx.belongs_to__application}`,
			},
			qs: {
				query: this.getDeviceQuery(ctx),
				limit: Number.isFinite(count) ? count : 1000,
				since: '30d',
			},
			json: true,
			gzip: LOKI_HISTORY_GZIP,
		});

		const logs = (
			body.data.result as Array<{
				values: Array<[timestamp: string, logLine: string]>;
			}>
		)
			.flatMap(({ values }) => values)
			.map(([timestamp, logLine]) => {
				const log = JSON.parse(logLine);
				log.nanoTimestamp = BigInt(timestamp);
				if (log.version !== VERSION) {
					throw new Error(
						`Invalid Loki serialization version: ${JSON.stringify(log)}`,
					);
				}
				delete log.version;
				return log as DeviceLog;
			});

		return _.orderBy(logs, 'nanoTimestamp', 'asc');
	}

	public async publish(
		ctx: LogContext,
		logs: Array<DeviceLog & { version?: number }>,
	): Promise<any> {
		const countLogs = logs.length;
		incrementPublishCallTotal();
		incrementPublishLogMessagesTotal(countLogs);
		const stream = this.fromDeviceLogsToStream(ctx, logs);
		const lokiCtx = await assertLokiLogContext(ctx);
		try {
			await this.push(lokiCtx.belongs_to__application, stream);
			incrementPublishCallSuccessTotal();
		} catch (err) {
			incrementPublishCallFailedTotal();
			incrementPublishLogMessagesDropped(countLogs);
			let message = `Failed to publish logs for device ${ctx.uuid}`;
			if (VERBOSE_ERROR_MESSAGE) {
				message += JSON.stringify(logs, omitNanoTimestamp, '\t').substring(
					0,
					1000,
				);
			}
			captureException(err, message);
			throw new BadRequestError(
				`Failed to publish logs for device ${ctx.uuid}`,
			);
		}
	}

	private push(appId: number, stream: loki.StreamAdapter): Promise<any> {
		incrementLokiPushTotal();
		const pushRequest = new loki.PushRequest();
		pushRequest.addStreams(stream);
		const startAt = Date.now();
		return new Promise<loki.PushResponse>((resolve, reject) => {
			this.pusher.push(
				pushRequest,
				loki.createOrgIdMetadata(String(appId)),
				{
					deadline: startAt + PUSH_TIMEOUT,
				},
				(err, response) => {
					if (err) {
						reject(err);
					} else {
						resolve(response);
					}
				},
			);
		}).finally(() => {
			updateLokiPushDurationHistogram(Date.now() - startAt);
		});
	}

	public async subscribe($ctx: LogContext, subscription: Subscription) {
		const ctx = await assertLokiLogContext($ctx);
		const key = this.getKey(ctx);
		if (!this.tailCalls.has(key)) {
			const request = new loki.TailRequest();
			request.setQuery(this.getDeviceQuery(ctx));
			request.setStart(createTimestampFromDate());

			const call = this.querier.tail(
				request,
				loki.createOrgIdMetadata(String(ctx.belongs_to__application)),
			);
			call.on('data', (response: loki.TailResponse) => {
				const stream = response.getStream();
				if (stream) {
					const logs = this.fromStreamToDeviceLogs(stream);
					for (const log of logs) {
						this.subscriptions.emit(key, log);
					}
				}
			});
			call.on('error', (err: Error & { details: string }) => {
				if (err.details !== 'Cancelled') {
					captureException(err, `Loki tail call error for device ${ctx.uuid}`);
				}
				this.subscriptions.removeListener(key, subscription);
				this.tailCalls.delete(key);
				setCurrentSubscriptions(this.tailCalls.size);
			});
			call.on('end', () => {
				this.subscriptions.removeListener(key, subscription);
				this.tailCalls.delete(key);
				setCurrentSubscriptions(this.tailCalls.size);
			});
			this.tailCalls.set(key, call);
			incrementSubscriptionTotal();
			setCurrentSubscriptions(this.tailCalls.size);
		}
		this.subscriptions.on(key, subscription);
	}

	public async unsubscribe($ctx: LogContext) {
		const ctx = await assertLokiLogContext($ctx);
		const key = this.getKey(ctx);
		const call = this.tailCalls.get(key);
		call?.cancel();
	}

	private getDeviceQuery(ctx: LogContext) {
		return `{device_id="${ctx.id}"}`;
	}

	private getKey(ctx: LokiLogContext, suffix = 'logs') {
		return `app:${ctx.belongs_to__application}:device:${ctx.id}:${suffix}`;
	}

	private getLabels(ctx: LogContext): string {
		return `{device_id="${ctx.id}"}`;
	}

	private validateLog(log: DeviceLog): asserts log is DeviceLog {
		if (typeof log.message !== 'string') {
			throw new BadRequestError('DeviceLog message must be string');
		} else if (typeof log.timestamp !== 'number') {
			throw new BadRequestError('DeviceLog timestamp must be number');
		} else if (typeof log.isSystem !== 'boolean') {
			throw new BadRequestError('DeviceLog isSystem must be boolean');
		} else if (typeof log.isStdErr !== 'boolean') {
			throw new BadRequestError('DeviceLog isStdErr must be boolean');
		} else if (
			typeof log.serviceId !== 'number' &&
			log.serviceId !== undefined
		) {
			throw new BadRequestError(
				'DeviceLog serviceId must be number or undefined',
			);
		}
	}

	private fromStreamToDeviceLogs(stream: loki.StreamAdapter): DeviceLog[] {
		try {
			return stream.getEntriesList().map((entry: loki.EntryAdapter) => {
				const log = JSON.parse(entry.getLine());
				const timestamp = entry.getTimestamp()!;
				log.nanoTimestamp =
					BigInt(timestamp.getSeconds()) * 1000000000n +
					BigInt(timestamp.getNanos());
				if (log.version !== VERSION) {
					throw new Error(
						`Invalid Loki serialization version: ${JSON.stringify(log)}`,
					);
				}
				delete log.version;
				return log as DeviceLog;
			});
		} catch (err) {
			captureException(err, `Failed to convert stream to device log`);
			return [];
		}
	}

	private fromDeviceLogsToStream(
		ctx: LogContext,
		logs: Array<DeviceLog & { version?: number }>,
	) {
		const labels = this.getLabels(ctx);
		const stream = new loki.StreamAdapter();
		stream.setLabels(labels);
		for (const log of logs) {
			this.validateLog(log);
			log.version = VERSION;
			const timestamp = new loki.Timestamp();
			timestamp.setSeconds(Math.floor(Number(log.nanoTimestamp / 1000000000n)));
			timestamp.setNanos(Number(log.nanoTimestamp % 1000000000n));
			// store log line as JSON
			const logJson = JSON.stringify(log, omitNanoTimestamp);
			// create entry with labels, line and timestamp
			const entry = new loki.EntryAdapter()
				.setLine(logJson)
				.setTimestamp(timestamp);
			// append entry to stream
			stream.addEntries(entry);
		}
		return stream;
	}
}
