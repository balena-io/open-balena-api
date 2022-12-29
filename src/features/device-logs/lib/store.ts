import type { Request, RequestHandler, Response } from 'express';
import type {
	DeviceLog,
	DeviceLogsBackend,
	LogWriteContext,
	SupervisorLog,
} from './struct';

import onFinished from 'on-finished';
import { sbvrUtils, errors } from '@balena/pinejs';
import { Supervisor } from './supervisor';
import { createGunzip } from 'zlib';
import ndjson from 'ndjson';
import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../../infra/error-handling';
import {
	addRetentionLimit,
	getBackend,
	getLokiBackend,
	LOKI_ENABLED,
	shouldPublishToLoki,
} from './config';
import { SetupOptions } from '../../..';
import { Device, PickDeferred } from '../../../balena-model';
import {
	LOGS_BACKEND_UNAVAILABLE_FLUSH_INTERVAL,
	LOGS_STREAM_FLUSH_INTERVAL,
	LOGS_WRITE_BUFFER_LIMIT,
	NDJSON_CTYPE,
} from '../../../lib/config';

const {
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
	ServiceUnavailableError,
	UnsupportedMediaTypeError,
} = errors;
const { api } = sbvrUtils;

const supervisor = new Supervisor();

const getWriteContext = async (req: Request): Promise<LogWriteContext> => {
	const { uuid } = req.params;
	return await sbvrUtils.db.readTransaction(async (tx) => {
		const resinApi = api.resin.clone({ passthrough: { req, tx } });
		const device = (await resinApi.get({
			resource: 'device',
			id: { uuid },
			options: {
				$select: ['id', 'logs_channel', 'belongs_to__application'],
			},
		})) as
			| PickDeferred<Device, 'id' | 'logs_channel' | 'belongs_to__application'>
			| undefined;
		if (!device) {
			throw new NotFoundError('No device with uuid ' + uuid);
		}
		await checkWritePermissions(resinApi, device);
		return addRetentionLimit<LogWriteContext>({
			id: device.id,
			belongs_to__application: device.belongs_to__application!.__id,
			logs_channel: device.logs_channel,
			uuid,
		});
	});
};

async function checkWritePermissions(
	resinApi: sbvrUtils.PinejsClient,
	ctx: { id: number },
): Promise<void> {
	const allowedDevices = (await resinApi.post({
		resource: 'device',
		id: ctx.id,
		body: { action: 'write-log' },
		url: `device(${ctx.id})/canAccess`,
	})) as { d?: Array<{ id: number }> };
	const device = allowedDevices.d && allowedDevices.d[0];
	if (!device || device.id !== ctx.id) {
		throw new UnauthorizedError('Not allowed to write device logs');
	}
}

export const store: RequestHandler = async (req: Request, res: Response) => {
	try {
		const body: SupervisorLog[] = req.body;
		const logs: DeviceLog[] = supervisor.convertLogs(body);
		if (logs.length) {
			const ctx = await getWriteContext(req);
			// start publishing to both backends
			await Promise.all([
				getBackend().publish(ctx, logs),
				shouldPublishToLoki()
					? getLokiBackend()
							.publish(ctx, logs)
							.catch((err) =>
								captureException(err, 'Failed to publish logs to Loki'),
							)
					: undefined,
			]);
		}
		res.status(201).end();
	} catch (err) {
		handleStoreErrors(req, res, err);
	}
};

export const storeStream =
	(
		onLogWriteStreamInitialized: SetupOptions['onLogWriteStreamInitialized'],
	): RequestHandler =>
	async (req: Request, res: Response) => {
		try {
			const ctx = await getWriteContext(req);
			handleStreamingWrite(ctx, req, res);
			onLogWriteStreamInitialized?.(req);
		} catch (err) {
			handleStoreErrors(req, res, err);
		}
	};

function handleStoreErrors(req: Request, res: Response, err: Error) {
	if (handleHttpErrors(req, res, err)) {
		return;
	}
	captureException(err, 'Failed to store device logs', { req });
	res.status(500).end();
}

const publishBackend = LOKI_ENABLED
	? async (
			backend: DeviceLogsBackend,
			ctx: LogWriteContext,
			buffer: DeviceLog[],
	  ) => {
			const publishingToRedis = backend.publish(ctx, buffer);
			const publishingToLoki = shouldPublishToLoki()
				? getLokiBackend()
						.publish(ctx, buffer)
						.catch((err) =>
							captureException(err, 'Failed to publish logs to Loki'),
						)
				: undefined;
			await Promise.all([publishingToRedis, publishingToLoki]);
	  }
	: async (
			backend: DeviceLogsBackend,
			ctx: LogWriteContext,
			buffer: DeviceLog[],
	  ) => {
			await backend.publish(ctx, buffer);
	  };

function handleStreamingWrite(
	ctx: LogWriteContext,
	req: Request,
	res: Response,
): void {
	if (ctx.logs_channel) {
		throw new BadRequestError(
			'The device must clear the `logs_channel` before using this endpoint',
		);
	}

	const backend = getBackend();
	// If the backend is down, reject right away, don't take in new connections
	if (!backend.available) {
		throw new ServiceUnavailableError('The logs storage is unavailable');
	}
	if (req.get('Content-Type') !== NDJSON_CTYPE) {
		throw new UnsupportedMediaTypeError(
			`Streaming requests require Content-Type ${NDJSON_CTYPE}`,
		);
	}

	const bufferLimit = Math.min(LOGS_WRITE_BUFFER_LIMIT, ctx.retention_limit);
	const buffer: DeviceLog[] = [];
	const parser = ndjson.parse();

	function close(err?: Error | null) {
		if (!res.headersSent) {
			// Handle both errors and normal close here
			if (err) {
				if (handleHttpErrors(req, res, err)) {
					return;
				}
				res.status(400).send(translateError(err));
			} else {
				res.status(201).end();
			}
		}
	}

	parser.on('error', close).on('data', (sLog: SupervisorLog) => {
		const log = supervisor.convertLog(sLog);
		if (!log) {
			return;
		}
		if (buffer.length === 0) {
			schedule();
		}
		buffer.push(log);
		// If we buffer too much or the backend goes down, pause it for back-pressure
		if (buffer.length >= bufferLimit || !backend.available) {
			req.pause();
		}
	});

	onFinished(req, close);
	onFinished(res, close);

	// Support optional GZip encoding
	if (req.get('Content-Encoding') === 'gzip') {
		req.pipe(createGunzip()).on('error', close).pipe(parser);
	} else {
		req.pipe(parser);
	}

	// NOTE: this is testing code to test logging behavior with cloudflare
	// these timers need to be defined in a non-harcoded way

	// Wait for the client to finish the grace period and connect the buffers
	setTimeout(pingClient, 5 * 1000);

	function pingClient() {
		if (!res.closed) {
			// Send a single byte back every 10 seconds
			res.write(Buffer.alloc(1, 1));
			setTimeout(pingClient, 10 * 1000);
		}
	}

	// https://stackoverflow.com/a/44780406/1559300
	req.on('socket', (s) => {
		s.setKeepAlive(true, 240 * 1000);
	});

	let publishScheduled = false;

	async function tryPublish() {
		try {
			// Don't flush if the backend is reporting as unavailable
			if (buffer.length && backend.available) {
				if (buffer.length > bufferLimit) {
					// Ensure the buffer cannot be larger than the buffer limit, adding a warning message if we removed messages
					const deleteCount = buffer.length - bufferLimit;
					buffer.splice(0, deleteCount, {
						nanoTimestamp: buffer[0].nanoTimestamp,
						createdAt: buffer[0].createdAt,
						timestamp: buffer[0].timestamp,
						isStdErr: true,
						isSystem: true,
						message: `Warning: Suppressed ${deleteCount} message(s) due to rate limiting`,
					});
				}
				// Even if the connection was closed, still flush the buffer
				const publishPromise = publishBackend(backend, ctx, buffer);
				// Clear the buffer
				buffer.length = 0;
				// Resume in case it was paused due to buffering
				if (req.isPaused()) {
					req.resume();
				}
				// Wait for publishing to complete
				await publishPromise;
			}
			publishScheduled = false;

			// Reschedule publishing if more logs arrived whilst we were in progress
			if (buffer.length > 0) {
				schedule();
			}
		} catch (err) {
			handleStoreErrors(req, res, err);
		}
	}
	function schedule() {
		if (publishScheduled !== false) {
			return;
		}
		// If the backend goes down temporarily, ease down the polling
		const delay = backend.available
			? LOGS_STREAM_FLUSH_INTERVAL
			: LOGS_BACKEND_UNAVAILABLE_FLUSH_INTERVAL;
		setTimeout(tryPublish, delay);
		publishScheduled = true;
	}
}
