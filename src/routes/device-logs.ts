import { createGunzip } from 'zlib';
import * as Promise from 'bluebird';
import { Request, Response, RequestHandler } from 'express';
import * as _ from 'lodash';
import * as ndjson from 'ndjson';

import { RedisBackend } from '../lib/device-logs/backends/redis';
import {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	LogWriteContext,
	AnySupervisorLog,
	SupervisorLog,
	StreamState,
} from '../lib/device-logs/struct';
import { Supervisor } from '../lib/device-logs/supervisor';
import { captureException, handleHttpErrors } from '../platform/errors';
import {
	PinejsClient,
	resinApi,
	sbvrUtils,
	Tx,
	wrapInTransaction,
} from '../platform';

const {
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
	ServiceUnavailableError,
	UnsupportedMediaTypeError,
} = sbvrUtils;

const HEARTBEAT_INTERVAL = 58e3;
const STREAM_FLUSH_INTERVAL = 500;
const BACKEND_UNAVAILABLE_FLUSH_INTERVAL = 5000;
const NDJSON_CTYPE = 'application/x-ndjson';
const WRITE_BUFFER_LIMIT = 50;
const DEFAULT_HISTORY_LOGS = 1000;
const DEFAULT_RETENTION_LIMIT = 1000;
const DEFAULT_SUBSCRIPTION_LOGS = 0;

const redis = new RedisBackend();
const supervisor = new Supervisor();

// Reading logs section

export function read(req: Request, res: Response) {
	const api = resinApi.clone({ passthrough: { req } });
	return getReadContext(api, req)
		.then(ctx => {
			if (req.query.stream === '1') {
				addRetentionLimit(ctx);
				return handleStreamingRead(ctx, res);
			}
			return getHistory(ctx, DEFAULT_HISTORY_LOGS).then(logs => {
				res.json(logs);
			});
		})
		.catch((err: Error) => {
			if (handleHttpErrors(req, res, err)) {
				return;
			}
			captureException(err, 'Failed to read device logs', { req });
			res.sendStatus(500);
		});
}

function handleStreamingRead(ctx: LogContext, res: Response) {
	let state = StreamState.Buffering;
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
			onLog({
				createdAt: Date.now(),
				timestamp: Date.now(),
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

	ctx.req.on('aborted', close);
	res.on('close', close);

	// Subscribe in parallel so we don't miss logs in between
	getBackend(ctx).subscribe(ctx, onLog);
	return getHistory(ctx, DEFAULT_SUBSCRIPTION_LOGS)
		.tapCatch(close)
		.then(logs => {
			if (state === StreamState.Closed) {
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
		});
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

	const parsedCount = _.parseInt(countParam, 10);

	if (!_.isNaN(parsedCount)) {
		return parsedCount;
	} else {
		return defaultCount;
	}
}

function getHistory(
	ctx: LogContext,
	defaultCount: number,
): Promise<DeviceLog[]> {
	const { query } = ctx.req;
	const count = getCount(query.count, defaultCount);

	// Optimize the case where the caller doesn't need any history
	if (!count) {
		return Promise.resolve([]);
	}

	// TODO: Implement `?since` filter here too in the next phase
	return getBackend(ctx).history(ctx, count);
}

// Writing logs section

export const store: RequestHandler = wrapInTransaction(
	(tx: Tx, req: Request, res: Response) => {
		const api = resinApi.clone({ passthrough: { req, tx } });
		return getWriteContext(api, req)
			.tap(checkWritePermissions)
			.tap(addRetentionLimit)
			.then(ctx => {
				const body: AnySupervisorLog[] = req.body;
				const logs: DeviceLog[] = supervisor.convertLogs(ctx, body);
				if (logs.length) {
					return getBackend(ctx).publish(ctx, logs);
				}
			})
			.then(() => {
				res.sendStatus(201);
			})
			.catch(handleStoreErrors(req, res));
	},
);

export function storeStream(req: Request, res: Response) {
	const api = resinApi.clone({ passthrough: { req } });
	return getWriteContext(api, req)
		.tap(checkWritePermissions)
		.tap(addRetentionLimit)
		.then(ctx => {
			return handleStreamingWrite(ctx, res);
		})
		.catch(handleStoreErrors(req, res));
}

function handleStoreErrors(req: Request, res: Response) {
	return function(err: Error) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Failed to store device logs', { req });
		res.sendStatus(500);
	};
}

function handleStreamingWrite(ctx: LogWriteContext, res: Response): void {
	if (ctx.logs_channel) {
		throw new BadRequestError(
			'The device must clear the `logs_channel` before using this endpoint',
		);
	}

	const backend = getBackend(ctx);
	// If the backend is down, reject right away, don't take in new connections
	if (!backend.available) {
		throw new ServiceUnavailableError('The logs storage is unavailable');
	}
	const { req } = ctx;
	if (req.get('Content-Type') !== NDJSON_CTYPE) {
		throw new UnsupportedMediaTypeError(
			`Streaming requests require Content-Type ${NDJSON_CTYPE}`,
		);
	}

	let buffer: DeviceLog[] = [];
	const parser = ndjson.parse();

	function close(err?: Error) {
		if (!res.headersSent) {
			// Handle both errors and normal close here
			if (err) {
				res.status(400).send(err.message);
			} else {
				res.sendStatus(201);
			}
		}
	}

	parser.on('error', close).on('data', (sLog: SupervisorLog) => {
		const log = supervisor.convertLog(sLog);
		if (log) {
			buffer.push(log);
		}
		// If we buffer too much or the backend goes down, pause it for back-pressure
		if (buffer.length >= WRITE_BUFFER_LIMIT || !backend.available) {
			req.pause();
		}
	});

	req.on('error', close);
	res.on('error', close).on('close', close);

	// Support optional GZip encoding
	if (req.get('Content-Encoding') === 'gzip') {
		req
			.pipe(createGunzip())
			.on('error', close)
			.pipe(parser);
	} else {
		req.pipe(parser);
	}

	const errHandler = handleStoreErrors(ctx.req, res);

	function schedule() {
		// If the backend goes down temporarily, ease down the polling
		const delay = backend.available
			? STREAM_FLUSH_INTERVAL
			: BACKEND_UNAVAILABLE_FLUSH_INTERVAL;
		Promise.delay(delay)
			.then(() => {
				// Don't flush if the backend is reporting as unavailable
				if (buffer.length && backend.available) {
					// Even if the connection was closed, still flush the buffer
					const promise = backend.publish(ctx, buffer);
					buffer = [];
					// Resume in case it was paused due to buffering
					if (req.isPaused()) {
						req.resume();
					}
					return promise;
				}
			})
			.then(() => {
				// If headers were sent, it means the connection is ended
				if (!res.headersSent || buffer.length) {
					// We do not return the schedule promise as the recursion causes a memory leak
					schedule();
					// We return null here to avoid promise warnings
					return null;
				}
			})
			.catch(errHandler);
	}
	schedule();
}

function getReadContext(api: PinejsClient, req: Request): Promise<LogContext> {
	const { uuid } = req.params;
	return api
		.get({
			resource: 'device',
			options: {
				$filter: { uuid },
				$select: ['id', 'logs_channel'],
			},
		})
		.then(([ctx]: LogContext[]) => {
			if (!ctx) {
				throw new NotFoundError('No device with uuid ' + uuid);
			}
			ctx.uuid = uuid;
			ctx.req = req;
			ctx.resinApi = api;
			return ctx;
		});
}

function getWriteContext(
	api: PinejsClient,
	req: Request,
): Promise<LogWriteContext> {
	const { uuid } = req.params;
	return api
		.get({
			resource: 'device',
			options: {
				$filter: { uuid },
				$select: ['id', 'logs_channel'],
				$expand: {
					image_install: {
						$select: 'id',
						$expand: {
							image: {
								$select: 'id',
								$expand: { is_a_build_of__service: { $select: 'id' } },
							},
						},
					},
				},
			},
		})
		.then(([ctx]: LogWriteContext[]) => {
			if (!ctx) {
				throw new NotFoundError('No device with uuid ' + uuid);
			}
			ctx.uuid = uuid;
			ctx.req = req;
			ctx.resinApi = api;
			return ctx;
		});
}

function addRetentionLimit(ctx: LogContext) {
	ctx.retention_limit = DEFAULT_RETENTION_LIMIT;
}

function checkWritePermissions(ctx: LogWriteContext): Promise<void> {
	return ctx.resinApi
		.post({
			resource: 'device',
			id: ctx.id,
			body: { action: 'write-log' },
			url: `device(${ctx.id})/canAccess`,
		})
		.then((allowedDevices: { d?: Array<{ id: number }> }) => {
			const device = allowedDevices.d && allowedDevices.d[0];
			if (!device || device.id !== ctx.id) {
				throw new UnauthorizedError('Not allowed to write device logs');
			}
		});
}

function getBackend(_ctx: LogContext): DeviceLogsBackend {
	return redis;
}
