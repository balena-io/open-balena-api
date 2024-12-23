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
	LOKI_RETRIES_ENABLED,
	LOKI_PUSH_TIMEOUT,
} from '../../../../lib/config.js';
import type {
	DeviceLogsBackend,
	InternalDeviceLog,
	LogContext,
	LokiLogContext,
	OutputDeviceLog,
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

interface LokiDeviceLog extends Omit<InternalDeviceLog, 'nanoTimestamp'> {
	version?: number;
	createdAt?: number;
}

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

const MIN_BACKOFF = 100;
const MAX_BACKOFF = 10 * 1000;
const VERSION = 2;

function createTimestampFromDate(date = new Date()) {
	const timestamp = new loki.Timestamp();
	timestamp.fromDate(date);
	return timestamp;
}

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

/**
 * This converts a standard log context to a loki context, if a loki context is the most common
 * then it would make sense to combine this fetch in the initial context fetch but currently that
 * is not the case anywhere
 */
async function assertLokiLogContext(
	ctx: LogContext & Partial<LokiLogContext>,
): Promise<LokiLogContext> {
	if ('appId' in ctx && 'orgId' in ctx) {
		return ctx as types.RequiredField<typeof ctx, 'appId' | 'orgId'>;
	}

	const device = await sbvrUtils.api.resin.get({
		resource: 'device',
		id: ctx.id,
		passthrough: { req: permissions.root },
		options: {
			$select: ['belongs_to__application'],
			$expand: {
				belongs_to__application: {
					$select: ['id', 'organization'],
				},
			},
		},
	});

	if (device == null) {
		throw new Error(`Device '${ctx.id}' not found`);
	}

	if (device.belongs_to__application[0] == null) {
		throw new Error(`Device '${ctx.id}' app not found`);
	}

	// Mutate so that we don't have to repeatedly amend the same context and instead cache it
	(ctx as Writable<typeof ctx>).appId =
		`${device.belongs_to__application[0].id}`;
	(ctx as Writable<typeof ctx>).orgId =
		`${device.belongs_to__application[0].organization.__id}`;

	return ctx as types.RequiredField<typeof ctx, 'appId' | 'orgId'>;
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
					LOKI_RETRIES_ENABLED &&
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
	public async history(
		$ctx: LogContext,
		count: number,
	): Promise<OutputDeviceLog[]> {
		const ctx = await assertLokiLogContext($ctx);

		const [, body] = await requestAsync({
			url: `http://${lokiQueryAddress}/loki/api/v1/query_range`,
			headers: {
				'X-Scope-OrgID': ctx.orgId,
			},
			qs: {
				query: this.getDeviceQuery(ctx),
				limit: Number.isFinite(count) ? count : 1000,
				since: '30d',
			},
			json: true,
			gzip: LOKI_HISTORY_GZIP,
		});

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
		ctx: LogContext,
		logs: Array<InternalDeviceLog & { version?: number }>,
	): Promise<any> {
		const logEntries = this.fromDeviceLogsToEntries(ctx, logs);

		const countLogs = logs.length;
		incrementPublishCallTotal();
		incrementPublishLogMessagesTotal(countLogs);
		const lokiCtx = await assertLokiLogContext(ctx);
		const stream = this.fromLogEntriesToStream(lokiCtx, logEntries);
		try {
			await this.push(lokiCtx, stream);
			incrementPublishCallSuccessTotal();
		} catch (err) {
			incrementPublishCallFailedTotal();
			incrementPublishLogMessagesDropped(countLogs);
			captureException(
				err,
				`Failed to publish logs for device ${lokiCtx.uuid}`,
			);
			throw new BadRequestError(
				`Failed to publish logs for device ${lokiCtx.uuid}`,
			);
		}
	}

	private async push(
		ctx: LokiLogContext,
		stream: loki.StreamAdapter,
	): Promise<void> {
		incrementLokiPushTotal();
		const pushRequest = new loki.PushRequest();
		pushRequest.addStreams(stream);
		const startAt = Date.now();
		try {
			await new Promise<loki.PushResponse>((resolve, reject) => {
				this.pusher.push(
					pushRequest,
					loki.createOrgIdMetadata(ctx.orgId),
					{
						deadline: startAt + LOKI_PUSH_TIMEOUT,
					},
					(err, response) => {
						if (err) {
							reject(err);
						} else {
							resolve(response);
						}
					},
				);
			});
		} finally {
			updateLokiPushDurationHistogram(Date.now() - startAt);
		}
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
				loki.createOrgIdMetadata(ctx.orgId),
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
			call.on('error', (err: Error & { code: loki.status }) => {
				if (err.code !== loki.status.CANCELLED) {
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

	private getDeviceQuery(ctx: LokiLogContext) {
		return `{fleet_id="${ctx.appId}"} | device_id="${ctx.id}"`;
	}

	private getKey(ctx: LokiLogContext) {
		return `o${ctx.orgId}:a${ctx.appId}:d${ctx.id}`;
	}

	private getStructuredMetadata(ctx: LogContext): loki.LabelPairAdapter[] {
		return [
			new loki.LabelPairAdapter().setName('device_id').setValue(`${ctx.id}`),
		];
	}

	private getLabels(ctx: LokiLogContext): string {
		return `{fleet_id="${ctx.appId}"}`;
	}

	private fromStreamToDeviceLogs(
		stream: loki.StreamAdapter,
	): OutputDeviceLog[] {
		try {
			return stream.getEntriesList().map((entry) => {
				const log: LokiDeviceLog = JSON.parse(entry.getLine());
				if (log.version !== VERSION) {
					throw new Error(
						`Invalid Loki serialization version: ${JSON.stringify(log)}`,
					);
				}
				delete log.version;
				const timestampEntry = entry.getTimestamp()!;
				const nanoTimestamp =
					BigInt(timestampEntry.getSeconds()) * 1000000000n +
					BigInt(timestampEntry.getNanos());
				log.createdAt = Math.floor(Number(nanoTimestamp / 1000000n));
				return log as OutputDeviceLog;
			});
		} catch (err) {
			captureException(err, `Failed to convert stream to device log`);
			return [];
		}
	}

	private fromDeviceLogsToEntries(
		ctx: LogContext,
		logs: Array<InternalDeviceLog & { version?: number }>,
	) {
		const structuredMetadata = this.getStructuredMetadata(ctx);
		return logs.map((log) => {
			const timestamp = new loki.Timestamp();
			timestamp.setSeconds(Math.floor(Number(log.nanoTimestamp / 1000000000n)));
			timestamp.setNanos(Number(log.nanoTimestamp % 1000000000n));
			// store log line as JSON
			const logJson = JSON.stringify(
				{ ...log, version: VERSION },
				omitNanoTimestamp,
			);
			// create entry with labels, line and timestamp
			return new loki.EntryAdapter()
				.setLine(logJson)
				.setTimestamp(timestamp)
				.setStructuredmetadataList(structuredMetadata);
		});
	}
	private fromLogEntriesToStream(
		ctx: LokiLogContext,
		logEntries: loki.EntryAdapter[],
	) {
		const labels = this.getLabels(ctx);
		const stream = new loki.StreamAdapter();
		stream.setLabels(labels);
		stream.setEntriesList(logEntries);
		return stream;
	}
}
