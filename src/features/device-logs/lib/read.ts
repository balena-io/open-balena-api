import type { Request, RequestHandler, Response } from 'express';
import onFinished from 'on-finished';
import _ from 'lodash';
import { sbvrUtils, errors } from '@balena/pinejs';

import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';

import { DeviceLog, LogContext, StreamState } from './struct';
import { addRetentionLimit, getBackend } from './config';
import { getNanoTimestamp } from '../../../lib/utils';
import { SetupOptions } from '../../..';
import { Device, PickDeferred } from '../../../balena-model';
import {
	LOGS_DEFAULT_HISTORY_COUNT,
	LOGS_DEFAULT_SUBSCRIPTION_COUNT,
	LOGS_HEARTBEAT_INTERVAL,
	LOGS_READ_STREAM_FLUSH_INTERVAL,
	NDJSON_CTYPE,
} from '../../../lib/config';

const { NotFoundError } = errors;
const { api } = sbvrUtils;

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
				const logs = await getHistory(ctx, req, LOGS_DEFAULT_HISTORY_COUNT);
				res.json(logs);
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
				!write(
					JSON.stringify(log, (key, value) =>
						key === 'nanoTimestamp' ? undefined : value,
					) + '\n',
				) &&
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

	function heartbeat() {
		if (state !== StreamState.Closed) {
			// In order to keep the connection alive, output new lines every now and then
			write('\n');
			setTimeout(heartbeat, LOGS_HEARTBEAT_INTERVAL);
		}
	}

	setTimeout(heartbeat, LOGS_HEARTBEAT_INTERVAL);

	function close() {
		if (state !== StreamState.Closed) {
			state = StreamState.Closed;
			getBackend().unsubscribe(ctx, onLog);
		}
	}

	onFinished(req, close);
	onFinished(res, close);

	// Subscribe in parallel so we don't miss logs in between
	getBackend().subscribe(ctx, onLog);
	try {
		const logs = await getHistory(ctx, req, LOGS_DEFAULT_SUBSCRIPTION_COUNT);

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
	return getBackend().history(ctx, count);
}

async function getReadContext(req: Request): Promise<LogContext> {
	const { uuid } = req.params;
	const device = (await api.resin.get({
		resource: 'device',
		id: { uuid },
		passthrough: { req },
		options: {
			$select: ['id', 'belongs_to__application'],
		},
	})) as PickDeferred<Device, 'id' | 'belongs_to__application'>;

	if (!device) {
		throw new NotFoundError('No device with uuid ' + uuid);
	}
	return addRetentionLimit({
		id: device.id,
		belongs_to__application: device.belongs_to__application!.__id,
		uuid,
	});
}
