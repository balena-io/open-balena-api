import type { Request, Response } from 'express';
import onFinished = require('on-finished');

import { sbvrUtils, errors } from '@balena/pinejs';

import { captureException, handleHttpErrors } from '../../platform/errors';

import { DeviceLog, LogContext, StreamState } from './struct';
import {
	addRetentionLimit,
	DEFAULT_HISTORY_LOGS,
	DEFAULT_SUBSCRIPTION_LOGS,
	getBackend,
	HEARTBEAT_INTERVAL,
	NDJSON_CTYPE,
} from './config';

const { NotFoundError } = errors;
const { api } = sbvrUtils;

export async function read(req: Request, res: Response) {
	try {
		const resinApi = api.resin.clone({ passthrough: { req } });
		const ctx = await getReadContext(resinApi, req);
		if (req.query.stream === '1') {
			addRetentionLimit(ctx);
			await handleStreamingRead(ctx, req, res);
		} else {
			const logs = await getHistory(ctx, req, DEFAULT_HISTORY_LOGS);
			res.json(logs);
		}
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Failed to read device logs', { req });
		res.sendStatus(500);
	}
}

async function handleStreamingRead(
	ctx: LogContext,
	req: Request,
	res: Response,
): Promise<void> {
	let state: StreamState = StreamState.Buffering;
	let dropped = 0;
	const buffer: DeviceLog[] = [];

	res.setHeader('Content-Type', NDJSON_CTYPE);
	res.setHeader('Cache-Control', 'no-cache');

	function onLog(log: DeviceLog) {
		if (state === StreamState.Buffering) {
			buffer.push(log);
		} else if (state === StreamState.Saturated) {
			dropped++;
		} else if (state !== StreamState.Closed) {
			if (
				!res.write(JSON.stringify(log) + '\n') &&
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
		state = StreamState.Writable;
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

	function heartbeat() {
		if (state !== StreamState.Closed) {
			// In order to keep the connection alive, output new lines every now and then
			res.write('\n');
			setTimeout(heartbeat, HEARTBEAT_INTERVAL);
		}
	}

	setTimeout(heartbeat, HEARTBEAT_INTERVAL);

	function close() {
		if (state !== StreamState.Closed) {
			state = StreamState.Closed;
			getBackend(ctx).unsubscribe(ctx, onLog);
		}
	}

	onFinished(req, close);
	onFinished(res, close);

	// Subscribe in parallel so we don't miss logs in between
	getBackend(ctx).subscribe(ctx, onLog);
	try {
		const logs = await getHistory(ctx, req, DEFAULT_SUBSCRIPTION_LOGS);

		// We need this cast as typescript narrows to `StreamState.Buffering`
		// because it ignores that during the `await` break it can be changed
		// TODO: remove this once typescript removes the incorrect narrowing
		if ((state as StreamState) === StreamState.Closed) {
			return;
		}

		const afterDate = logs.length && logs[logs.length - 1].createdAt;
		// Append the subscription logs to the history queue
		while (buffer.length) {
			const log = buffer.shift();
			if (log && log.createdAt > afterDate) {
				logs.push(log);
				// Ensure we don't send more than the retention limit
				if (ctx.retention_limit && logs.length > ctx.retention_limit) {
					logs.shift();
				}
			}
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
	if (countParam == null) {
		return defaultCount;
	}

	if (countParam === 'all') {
		return Infinity;
	}

	const parsedCount = parseInt(countParam, 10);

	if (!Number.isNaN(parsedCount)) {
		return parsedCount;
	} else {
		return defaultCount;
	}
}

function getHistory(
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
	return getBackend(ctx).history(ctx, count);
}

async function getReadContext(
	resinApi: sbvrUtils.PinejsClient,
	req: Request,
): Promise<LogContext> {
	const { uuid } = req.params;
	const ctx = (await resinApi.get({
		resource: 'device',
		id: { uuid },
		options: {
			$select: ['id', 'logs_channel'],
		},
	})) as LogContext;

	if (!ctx) {
		throw new NotFoundError('No device with uuid ' + uuid);
	}
	ctx.uuid = uuid;
	return ctx;
}
