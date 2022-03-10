import type { Request, RequestHandler, Response } from 'express';
import type { DeviceLog, LogWriteContext, SupervisorLog } from './struct';

import onFinished = require('on-finished');
import { sbvrUtils, errors } from '@balena/pinejs';
import { Supervisor } from './supervisor';
import { createGunzip } from 'zlib';
import * as ndjson from 'ndjson';
import {
	captureException,
	handleHttpErrors,
	translateError,
} from '../../../infra/error-handling';
import {
	addRetentionLimit,
	BACKEND_UNAVAILABLE_FLUSH_INTERVAL,
	getBackend,
	getLokiBackend,
	NDJSON_CTYPE,
	shouldPublishToLoki,
	STREAM_FLUSH_INTERVAL,
	WRITE_BUFFER_LIMIT,
} from './config';
import { SetupOptions } from '../../..';
import { Device, PickDeferred } from '../../../balena-model';

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
				getBackend(ctx).publish(ctx, logs),
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

	const backend = getBackend(ctx);
	// If the backend is down, reject right away, don't take in new connections
	if (!backend.available) {
		throw new ServiceUnavailableError('The logs storage is unavailable');
	}
	if (req.get('Content-Type') !== NDJSON_CTYPE) {
		throw new UnsupportedMediaTypeError(
			`Streaming requests require Content-Type ${NDJSON_CTYPE}`,
		);
	}

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
		if (buffer.length >= WRITE_BUFFER_LIMIT || !backend.available) {
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

	let publishScheduled = false;

	async function tryPublish() {
		try {
			// Don't flush if the backend is reporting as unavailable
			if (buffer.length && backend.available) {
				const limit = ctx.retention_limit;
				if (buffer.length > limit) {
					// Ensure the buffer cannot be larger than the retention limit
					buffer.splice(0, buffer.length - limit);
				}
				// Even if the connection was closed, still flush the buffer
				const publishingToRedis = backend.publish(ctx, buffer);
				const publishingToLoki = shouldPublishToLoki()
					? getLokiBackend()
							.publish(ctx, buffer)
							.catch((err) =>
								captureException(err, 'Failed to publish logs to Loki'),
							)
					: undefined;
				// Clear the buffer
				buffer.length = 0;
				// Resume in case it was paused due to buffering
				if (req.isPaused()) {
					req.resume();
				}
				// Wait for publishing to complete
				await Promise.all([publishingToRedis, publishingToLoki]);
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
			? STREAM_FLUSH_INTERVAL
			: BACKEND_UNAVAILABLE_FLUSH_INTERVAL;
		setTimeout(tryPublish, delay);
		publishScheduled = true;
	}
}
