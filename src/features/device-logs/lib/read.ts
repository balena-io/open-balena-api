import type { Request, RequestHandler, Response } from 'express';
import onFinished from 'on-finished';
import _ from 'lodash';
import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';

import type { DeviceLog, DeviceLogsBackend, LogContext } from './struct.js';
import { StreamState } from './struct.js';
import {
	addRetentionLimit,
	getPrimaryBackend,
	getSecondaryBackend,
	omitNanoTimestamp,
	shouldReadFromSecondary,
} from './config.js';
import { getNanoTimestamp } from '../../../lib/utils.js';
import type { SetupOptions } from '../../../index.js';
import {
	LOGS_DEFAULT_HISTORY_COUNT,
	LOGS_DEFAULT_RETENTION_LIMIT,
	LOGS_DEFAULT_SUBSCRIPTION_COUNT,
	LOGS_HEARTBEAT_INTERVAL,
	LOGS_READ_STREAM_FLUSH_INTERVAL,
	NDJSON_CTYPE,
} from '../../../lib/config.js';

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
			if (req.query.stream === '1') {
				await handleStreamingRead(ctx, req, res);
				onLogReadStreamInitialized?.(req);
			} else {
				const logs = await getHistory(
					await getReadBackend(),
					ctx,
					req,
					LOGS_DEFAULT_HISTORY_COUNT,
				);

				res
					.set('Content-Type', 'application/json')
					.send(JSON.stringify(logs, omitNanoTimestamp));
			}
		} catch (err) {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Failed to read device logs', { req });
			res.status(500).end();
		}
	};

async function handleStreamingRead(
	ctx: LogContext,
	req: Request,
	res: Response,
): Promise<void> {
	const backend = await getReadBackend();
	let state: StreamState = StreamState.Buffering;
	let dropped = 0;
	const buffer: DeviceLog[] = [];

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

	function onLog(log: DeviceLog) {
		if (state === StreamState.Buffering) {
			buffer.push(log);
		} else if (state === StreamState.Saturated) {
			dropped++;
		} else if (state !== StreamState.Closed) {
			if (
				!write(JSON.stringify(log, omitNanoTimestamp) + '\n') &&
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
				nanoTimestamp: getNanoTimestamp(),
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
		let logs = await getHistory(
			backend,
			ctx,
			req,
			LOGS_DEFAULT_SUBSCRIPTION_COUNT,
		);

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

function getHistory(
	backend: DeviceLogsBackend,
	ctx: LogContext,
	{ query }: Request,
	defaultCount: number,
): Resolvable<DeviceLog[]> {
	const count = getCount(query.count as string | undefined, defaultCount);

	// Optimize the case where the caller doesn't need any history
	if (!count) {
		return [];
	}

	// TODO: Implement `?since` filter here too in the next phase
	return backend.history(ctx, count);
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
