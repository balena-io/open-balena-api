import type { Request, RequestHandler, Response } from 'express';
import type {
	AnySupervisorLog,
	DeviceLog,
	LogWriteContext,
	SupervisorLog,
} from './struct';

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
	getLokiBackend,
	getRedisBackend,
	NDJSON_CTYPE,
	shouldPublishToLoki,
	STREAM_FLUSH_INTERVAL,
	WRITE_BUFFER_LIMIT,
} from './config';

const {
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
	ServiceUnavailableError,
	UnsupportedMediaTypeError,
} = errors;
const { api } = sbvrUtils;

const supervisor = new Supervisor();

async function getWriteContext(
	resinApi: sbvrUtils.PinejsClient,
	req: Request,
): Promise<LogWriteContext> {
	const { uuid } = req.params;
	const device = (await resinApi.get({
		resource: 'device',
		id: { uuid },
		options: {
			$select: ['id', 'logs_channel', 'belongs_to__application'],
			$expand: {
				image_install: {
					$select: 'id',
					$expand: {
						image: {
							$select: 'id',
							$expand: { is_a_build_of__service: { $select: 'id' } },
						},
					},
					$filter: {
						status: { $ne: 'deleted' },
					},
				},
			},
		},
	})) as
		| {
				id: number;
				logs_channel?: string;
				belongs_to__application: {
					__id: number;
				};
				image_install: Array<{
					id: number;
					image: Array<{
						id: number;
						is_a_build_of__service: Array<{
							id: number;
						}>;
					}>;
				}>;
		  }
		| undefined;
	if (!device) {
		throw new NotFoundError('No device with uuid ' + uuid);
	}
	return {
		id: device.id,
		belongs_to__application: device.belongs_to__application.__id,
		logs_channel: device.logs_channel,
		uuid,
		images: device.image_install.map((imageInstall) => {
			const img = imageInstall.image[0];
			return {
				id: img.id,
				serviceId: img.is_a_build_of__service[0]?.id,
			};
		}),
	};
}

async function checkWritePermissions(
	resinApi: sbvrUtils.PinejsClient,
	ctx: LogWriteContext,
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
		const resinApi = api.resin.clone({ passthrough: { req } });
		const ctx = await getWriteContext(resinApi, req);
		await checkWritePermissions(resinApi, ctx);
		addRetentionLimit(ctx);
		const body: AnySupervisorLog[] = req.body;
		const logs: DeviceLog[] = supervisor.convertLogs(ctx, body);
		if (logs.length) {
			// start publishing to both backends
			await Promise.all([
				getRedisBackend().publish(ctx, logs),
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

export async function storeStream(req: Request, res: Response) {
	const resinApi = api.resin.clone({ passthrough: { req } });
	try {
		const ctx = await getWriteContext(resinApi, req);
		await checkWritePermissions(resinApi, ctx);
		addRetentionLimit(ctx);
		handleStreamingWrite(ctx, req, res);
	} catch (err) {
		handleStoreErrors(req, res, err);
	}
}

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

	const redisBackend = getRedisBackend();
	// If the backend is down, reject right away, don't take in new connections
	if (!redisBackend.available) {
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
		if (log) {
			buffer.push(log);
		}
		// If we buffer too much or the backend goes down, pause it for back-pressure
		if (buffer.length >= WRITE_BUFFER_LIMIT || !redisBackend.available) {
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

	async function schedule() {
		try {
			// Don't flush if the backend is reporting as unavailable
			if (buffer.length && redisBackend.available) {
				// Even if the connection was closed, still flush the buffer
				const publishingToRedis = redisBackend.publish(ctx, buffer);
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

			// If headers were sent, it means the connection is ended
			if (!res.headersSent || buffer.length) {
				// If the backend goes down temporarily, ease down the polling
				const delay = redisBackend.available
					? STREAM_FLUSH_INTERVAL
					: BACKEND_UNAVAILABLE_FLUSH_INTERVAL;
				setTimeout(schedule, delay);
			}
		} catch (err) {
			handleStoreErrors(req, res, err);
		}
	}
	schedule();
}
