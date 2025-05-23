import type { Request, RequestHandler, Response } from 'express';
import onFinished from 'on-finished';
import _ from 'lodash';
import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';

import type {
	DeviceLogsBackend,
	HistoryOpts,
	LogContext,
	OutputDeviceLog,
} from './struct.js';
import { StreamState } from './struct.js';
import {
	addRetentionLimit,
	getPrimaryBackend,
	getSecondaryBackend,
	shouldReadFromSecondary,
} from './config.js';
import type { SetupOptions } from '../../../index.js';
import {
	LOGS_DEFAULT_HISTORY_COUNT,
	LOGS_DEFAULT_HISTORY_LOOKBACK,
	LOGS_DEFAULT_HISTORY_STREAMING_LOOKBACK,
	LOGS_DEFAULT_RETENTION_LIMIT,
	LOGS_DEFAULT_SUBSCRIPTION_COUNT,
	LOGS_HEARTBEAT_INTERVAL,
	LOGS_READ_STREAM_FLUSH_INTERVAL,
	NDJSON_CTYPE,
} from '../../../lib/config.js';
import { DAYS } from '@balena/env-parsing';
import { checkInt } from '../../../lib/utils.js';

const { NotFoundError } = errors;
const { api } = sbvrUtils;

const getReadBackend = async () =>
	shouldReadFromSecondary()
		? await getSecondaryBackend()
		: await getPrimaryBackend();

export const read =
	(
		onLogReadStreamInitialized: SetupOptions['onLogReadStreamInitialized'],
	): RequestHandler =>
	async (req: Request, res: Response) => {
		try {
			const ctx = await getReadContext(req);
			const isStreamingRead = req.query.stream === '1';
			const count = getCount(
				req.query.count as string | undefined,
				isStreamingRead
					? LOGS_DEFAULT_SUBSCRIPTION_COUNT
					: LOGS_DEFAULT_HISTORY_COUNT,
			);
			const start = getStart(
				req.query.start as string | undefined,
				isStreamingRead
					? LOGS_DEFAULT_HISTORY_STREAMING_LOOKBACK
					: LOGS_DEFAULT_HISTORY_LOOKBACK,
			);
			if (isStreamingRead) {
				await handleStreamingRead(ctx, req, res, { count, start });
				onLogReadStreamInitialized?.(req);
			} else {
				const logs = await getHistory(await getReadBackend(), ctx, {
					count,
					start,
				});

				res.json(logs);
			}
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Failed to read device logs');
			res.status(500).end();
		}
	};

async function handleStreamingRead(
	ctx: LogContext,
	req: Request,
	res: Response,
	{ count, start }: HistoryOpts,
): Promise<void> {
	const backend = await getReadBackend();
	let state: StreamState = StreamState.Buffering;
	let dropped = 0;
	const buffer: OutputDeviceLog[] = [];

	res.setHeader('Content-Type', NDJSON_CTYPE);
	res.setHeader('Cache-Control', 'no-cache');

	const flush = _.throttle(
		() => {
			res.flush();
		},
		LOGS_READ_STREAM_FLUSH_INTERVAL,
		{ leading: false },
	);
	function write(data: string) {
		const r = res.write(data);
		flush();
		return r;
	}

	function onLog(log: OutputDeviceLog) {
		if (state === StreamState.Buffering) {
			buffer.push(log);
		} else if (state === StreamState.Saturated) {
			dropped++;
		} else if (state !== StreamState.Closed) {
			if (
				!write(JSON.stringify(log) + '\n') &&
				state === StreamState.Writable
			) {
				state = StreamState.Saturated;
			}
		}
	}

	res.on('drain', () => {
		if (state === StreamState.Closed) {
			return;
		}
		// Do not change to Writable, unless we are in a Saturated state.
		// Eg: We shouldn't change state if we are still Buffering, waiting for
		// getHistory to finish.
		if (state === StreamState.Saturated) {
			state = StreamState.Writable;
		}
		if (dropped) {
			const now = Date.now();
			onLog({
				createdAt: now,
				timestamp: now,
				isStdErr: true,
				isSystem: true,
				message: `Warning: Suppressed ${dropped} message(s) due to slow reading`,
			});
			dropped = 0;
		}
	});

	let heartbeatInterval: ReturnType<typeof setInterval> | undefined =
		setInterval(function heartbeat() {
			if (state === StreamState.Closed) {
				close();
				return;
			}
			// In order to keep the connection alive, output new lines every now and then
			write('\n');
		}, LOGS_HEARTBEAT_INTERVAL);

	function close() {
		if (state !== StreamState.Closed) {
			state = StreamState.Closed;
			backend.unsubscribe(ctx, onLog);
		}
		clearInterval(heartbeatInterval);
		heartbeatInterval = undefined;
	}

	onFinished(req, close);
	onFinished(res, close);

	// Subscribe in parallel so we don't miss logs in between
	backend.subscribe(ctx, onLog);
	try {
		let logs: OutputDeviceLog[];
		try {
			logs = await getHistory(backend, ctx, { count, start });
		} catch {
			// Continue with streaming logs if we fail to get history
			logs = [];
		}

		// We need this cast as typescript narrows to `StreamState.Buffering`
		// because it ignores that during the `await` break it can be changed
		// TODO: remove this once typescript removes the incorrect narrowing
		if ((state as StreamState) === StreamState.Closed) {
			return;
		}

		const afterDate = logs.at(-1)?.createdAt ?? 0;
		// Append the subscription logs to the history queue
		const firstAfterDateIndex = buffer.findIndex(
			(log) => log.createdAt > afterDate,
		);
		if (firstAfterDateIndex > 0) {
			buffer.splice(0, firstAfterDateIndex);
		}
		if (firstAfterDateIndex !== -1 && buffer.length > 0) {
			logs = logs.concat(buffer);
		}
		// Clear the buffer
		buffer.length = 0;
		// Ensure we don't send more than the retention limit
		if (ctx.retention_limit && logs.length > ctx.retention_limit) {
			logs.splice(0, logs.length - ctx.retention_limit);
		}

		// Ensure we don't drop the history logs "burst"
		state = StreamState.Flushing;
		logs.forEach(onLog);
		state = StreamState.Writable;
	} catch (e) {
		close();
		throw e;
	}
}

function getCount(
	countParam: string | undefined,
	defaultCount: number,
): number {
	let count: number;
	if (countParam == null) {
		count = defaultCount;
	} else if (countParam === 'all') {
		count = Infinity;
	} else {
		const parsedCount = parseInt(countParam, 10);
		if (!Number.isNaN(parsedCount)) {
			count = parsedCount;
		} else {
			count = defaultCount;
		}
	}
	return Math.min(count, LOGS_DEFAULT_RETENTION_LIMIT);
}

function getStart(
	startParam: string | undefined,
	defaultSince: number,
): number {
	let start: number | undefined;
	if (typeof startParam !== 'string') {
		start = Date.now() - defaultSince;
	} else {
		start = checkInt(startParam) || new Date(startParam).getTime();
		if (isNaN(start)) {
			start = Date.now() - defaultSince;
		}
	}
	if (start == null) {
		return start;
	}
	return Math.max(start, Date.now() - 30 * DAYS);
}

function getHistory(
	backend: DeviceLogsBackend,
	ctx: LogContext,
	opts: HistoryOpts,
): Resolvable<OutputDeviceLog[]> {
	// Optimize the case where the caller doesn't need any history
	if (!opts.count) {
		return [];
	}

	// TODO: Implement `?since` filter here too in the next phase
	return backend.history(ctx, opts);
}

async function getReadContext(req: Request): Promise<LogContext> {
	const { uuid } = req.params;
	const device = await api.resin.get({
		resource: 'device',
		id: { uuid },
		passthrough: { req },
		options: {
			$select: ['id'],
		},
	});

	if (!device) {
		throw new NotFoundError('No device with uuid ' + uuid);
	}
	return addRetentionLimit({
		id: device.id,
		uuid,
	});
}
