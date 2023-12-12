import type { Request, RequestHandler, Response } from 'express';
import type {
	DeviceLog,
	DeviceLogsBackend,
	LogContext,
	SupervisorLog,
} from './struct';

import * as _ from 'lodash';
import onFinished from 'on-finished';
import { sbvrUtils, errors, permissions } from '@balena/pinejs';
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
import {
	DEVICE_LOGS_WRITE_AUTH_CACHE_TIMEOUT,
	LOGS_BACKEND_UNAVAILABLE_FLUSH_INTERVAL,
	LOGS_STREAM_FLUSH_INTERVAL,
	LOGS_WRITE_BUFFER_LIMIT,
	NDJSON_CTYPE,
} from '../../../lib/config';
import {
	multiCacheMemoizee,
	reqPermissionNormalizer,
} from '../../../infra/cache';

const {
	UnauthorizedError,
	ServiceUnavailableError,
	UnsupportedMediaTypeError,
} = errors;
const { api } = sbvrUtils;

const supervisor = new Supervisor();

const getWriteContext = (() => {
	const authQuery = _.once(() =>
		api.resin.prepare<{ uuid: string }>({
			method: 'POST',
			url: `device(uuid=@uuid)/canAccess`,
			body: { action: 'write-log' },
		}),
	);
	const $getWriteContext = multiCacheMemoizee(
		async (
			uuid: string,
			req: permissions.PermissionReq,
		): Promise<false | LogContext> => {
			return await sbvrUtils.db.readTransaction(async (tx) => {
				try {
					const result = await authQuery()({ uuid }, undefined, { req, tx });
					const deviceId: number | undefined = result?.d?.[0]?.id;
					if (deviceId == null) {
						return false;
					}
					return addRetentionLimit({
						id: deviceId,
						uuid,
					});
				} catch {
					return false;
				}
			});
		},
		{
			cacheKey: 'getDeviceLogsWriteContext',
			promise: true,
			primitive: true,
			maxAge: DEVICE_LOGS_WRITE_AUTH_CACHE_TIMEOUT,
			normalizer: ([uuid, req]) => {
				return `${uuid}$${reqPermissionNormalizer(req)}`;
			},
		},
	);
	return async (req: Request): Promise<LogContext> => {
		const { uuid } = req.params;
		const maybeLogContext = await $getWriteContext(uuid, req);
		if (maybeLogContext === false) {
			throw new UnauthorizedError();
		}
		return maybeLogContext;
	};
})();

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
					? (await getLokiBackend())
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
			ctx: LogContext,
			buffer: DeviceLog[],
	  ) => {
			const publishingToRedis = backend.publish(ctx, buffer);
			const publishingToLoki = shouldPublishToLoki()
				? (await getLokiBackend())
						.publish(ctx, buffer)
						.catch((err) =>
							captureException(err, 'Failed to publish logs to Loki'),
						)
				: undefined;
			await Promise.all([publishingToRedis, publishingToLoki]);
	  }
	: async (
			backend: DeviceLogsBackend,
			ctx: LogContext,
			buffer: DeviceLog[],
	  ) => {
			await backend.publish(ctx, buffer);
	  };

function handleStreamingWrite(
	ctx: LogContext,
	req: Request,
	res: Response,
): void {
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
