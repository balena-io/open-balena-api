import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import { EventEmitter } from 'events';

import {
	ClientReadableStream,
	createInsecureCredentials,
	createOrgIdMetadata,
	Direction,
	EntryAdapter,
	IGrpcClientAsync,
	promisifyClient,
	PusherClient,
	PushRequest,
	QuerierClient,
	QueryRequest,
	QueryResponse,
	status,
	StreamAdapter,
	TailRequest,
	TailResponse,
	Timestamp,
} from 'loki-grpc-client';
import { errors } from '@balena/pinejs';
import { LOKI_HOST, LOKI_PORT } from '../../../../lib/config';
import {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	LogWriteContext,
	Subscription,
} from '../struct';
import { captureException } from '../../../../infra/error-handling';

const { BadRequestError } = errors;

const MIN_BACKOFF = 100;
const MAX_BACKOFF = 10 * 1000;
const VERSION = 1;

function createTimestampFromDate(date = new Date()) {
	const timestamp = new Timestamp();
	timestamp.fromDate(date);
	return timestamp;
}

function convertToNanoseconds(milliseconds: number, nonce: number) {
	const MS_TO_NANOS = 1000000;
	const seconds = Math.floor(milliseconds / 1000);
	const nanos = (milliseconds % 1000) * MS_TO_NANOS;

	// use nonce to create unique nanosecond component
	return [seconds, nanos + nonce];
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
					await Bluebird.delay(nextBackoff);
					// fibonacci
					nextBackoff = nextBackoff + prevBackoff;
					prevBackoff = nextBackoff - prevBackoff;
				} else {
					throw err;
				}
			}
		}
	};
}

export class LokiBackend implements DeviceLogsBackend {
	private subscriptions: EventEmitter;
	private querier: QuerierClient;
	private pusher: IGrpcClientAsync;
	private tailCalls: Map<string, ClientReadableStream<TailResponse>>;

	constructor() {
		this.subscriptions = new EventEmitter();
		this.querier = new QuerierClient(
			`${LOKI_HOST}:${LOKI_PORT}`,
			createInsecureCredentials(),
		);
		this.pusher = promisifyClient(
			new PusherClient(
				`${LOKI_HOST}:${LOKI_PORT}`,
				createInsecureCredentials(),
			),
		);
		this.tailCalls = new Map();
		this.push = backoff(this.push.bind(this), (err: any) =>
			[status.UNAVAILABLE, status.RESOURCE_EXHAUSTED].includes(err.code),
		);
	}

	public get available(): boolean {
		return true;
	}

	/**
	 *
	 * Return $count of logs matching device_id in descending (BACKWARD) order.
	 *
	 * The logs are sorted by timestamp since Loki returns a distinct stream for each label combination.
	 *
	 * @param ctx
	 * @param count
	 */
	public async history(ctx: LogContext, count: number): Promise<DeviceLog[]> {
		const oneHourAgo = new Date(Date.now() - 10000 * 60);

		const queryRequest = new QueryRequest();
		queryRequest.setSelector(this.getDeviceQuery(ctx));
		queryRequest.setLimit(Number.isFinite(count) ? count : 1000);
		queryRequest.setStart(createTimestampFromDate(oneHourAgo));
		queryRequest.setEnd(createTimestampFromDate());
		queryRequest.setDirection(Direction.BACKWARD);

		const streams: StreamAdapter[] = [];
		const call = this.querier.query(
			queryRequest,
			createOrgIdMetadata(String(ctx.belongs_to__application)),
		);
		const responseStreams: StreamAdapter[] = await new Promise(
			(resolve, reject) => {
				call.on('data', (queryResponse: QueryResponse) => {
					streams.push(...queryResponse.getStreamsList());
				});
				call.on('error', (error: Error & { details: string }) => {
					const message = `Failed to query logs for device ${ctx.uuid}`;
					captureException(error, message);
					reject(new BadRequestError(message));
				});
				call.on('end', () => {
					resolve(streams);
				});
			},
		);
		return _.orderBy(
			this.fromStreamsToDeviceLogs(responseStreams),
			'timestamp',
			'asc',
		);
	}

	public async publish(
		ctx: LogWriteContext,
		logs: Array<DeviceLog & { version?: number }>,
	): Promise<any> {
		const streams = this.fromDeviceLogsToStreams(ctx, logs);
		try {
			await this.push(ctx.belongs_to__application, streams);
		} catch (err) {
			captureException(err);
			throw new BadRequestError(
				`Failed to publish logs for device ${ctx.uuid}`,
			);
		}
	}

	private push(appId: number, streams: StreamAdapter[]): Promise<any> {
		const pushRequest = new PushRequest();
		pushRequest.setStreamsList(streams);
		return this.pusher.push(pushRequest, createOrgIdMetadata(String(appId)));
	}

	public subscribe(ctx: LogContext, subscription: Subscription) {
		const key = this.getKey(ctx);
		if (!this.tailCalls.has(key)) {
			const request = new TailRequest();
			request.setQuery(this.getDeviceQuery(ctx));
			request.setStart(createTimestampFromDate());

			const call = this.querier.tail(
				request,
				createOrgIdMetadata(String(ctx.belongs_to__application)),
			);
			call.on('data', (response: TailResponse) => {
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
					captureException(err, 'Loki tail call error.');
				}
				this.subscriptions.removeListener(key, subscription);
				this.tailCalls.delete(key);
			});
			call.on('end', () => {
				this.subscriptions.removeListener(key, subscription);
				this.tailCalls.delete(key);
			});
			this.tailCalls.set(key, call);
		}
		this.subscriptions.on(key, subscription);
	}

	public unsubscribe(ctx: LogContext) {
		const key = this.getKey(ctx);
		const call = this.tailCalls.get(key);
		call?.cancel();
	}

	private getDeviceQuery(ctx: LogContext) {
		return `{device_id="${ctx.id}"}`;
	}

	private getKey(ctx: LogContext, suffix = 'logs') {
		return `app:${ctx.belongs_to__application}:device:${ctx.id}:${suffix}`;
	}

	private getLabels(ctx: LogContext, log: DeviceLog): string {
		return `{device_id="${ctx.id}", service_id="${log.serviceId ?? 'null'}"}`;
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

	private fromStreamsToDeviceLogs(streams: StreamAdapter[]): DeviceLog[] {
		return streams.flatMap(this.fromStreamToDeviceLogs);
	}

	private fromStreamToDeviceLogs(stream: StreamAdapter): DeviceLog[] {
		try {
			return stream.getEntriesList().map((entry: EntryAdapter) => {
				const log = JSON.parse(entry.getLine());
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

	private fromDeviceLogsToStreams(
		ctx: LogWriteContext,
		logs: Array<DeviceLog & { version?: number }>,
	) {
		let nonce = 0;
		const streams: StreamAdapter[] = [];
		const streamIndex: { [key: string]: StreamAdapter } = {}; // index streams by labels for fast lookup
		for (const log of logs) {
			this.validateLog(log);
			log.version = VERSION;
			const [seconds, nanoseconds] = convertToNanoseconds(
				log.timestamp,
				nonce++,
			);
			const timestamp = new Timestamp();
			timestamp.setSeconds(seconds);
			timestamp.setNanos(nanoseconds);
			// store log line as JSON
			const logJson = JSON.stringify(log);
			// create entry with labels, line and timestamp
			const entry = new EntryAdapter().setLine(logJson).setTimestamp(timestamp);
			const labels = this.getLabels(ctx, log);
			// append entry to stream
			let stream = streamIndex[labels];
			if (!stream) {
				// new stream if none exist for labels
				stream = new StreamAdapter();
				stream.setLabels(labels);
				streams.push(stream);
				streamIndex[labels] = stream;
			}
			stream.addEntries(entry);
		}
		return streams;
	}
}
