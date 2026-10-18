import _ from 'lodash';
import http from 'node:http';
import {
	compressionAlgorithms,
	credentials,
	makeGenericClientConstructor,
	Metadata,
	status,
} from '@grpc/grpc-js';
import type { CallOptions, Client, ServiceError } from '@grpc/grpc-js';
import {
	LOKI_INGESTER_HOST,
	LOKI_INGESTER_GRPC_PORT,
	LOKI_INGESTER_HTTP_PORT,
	LOKI_GRPC_SEND_GZIP,
	LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL,
} from '../../../../lib/config.js';
import type { LokiStream } from './loki-push-request.ts';
import { encodePushRequest } from './loki-push-request.ts';

/** Sends push requests to Loki, over gRPC or HTTP */
export interface LokiPusher {
	push(orgId: string, streams: LokiStream[], deadline: number): Promise<void>;
	/** The label for a failed push in the `api_device_logs_loki_push_error_total` metric */
	errorLabel(err: any): string;
	/** Whether a failed push may succeed if it is retried */
	isRetryable(err: any): boolean;
}

// invert status object for quick lookup of status identifier using status code
const statusKeys = _.invert(status);

const notSupported = () => {
	throw new Error(
		'Only the client side of the Loki push service is implemented',
	);
};
// The Loki push service, with requests encoded by `encodePushRequest` straight from plain objects rather than by
// building and serializing google-protobuf messages
const PusherClient = makeGenericClientConstructor(
	{
		push: {
			path: '/logproto.Pusher/Push',
			requestStream: false,
			responseStream: false,
			requestSerialize: encodePushRequest,
			requestDeserialize: notSupported,
			responseSerialize: notSupported,
			// PushResponse has no fields
			responseDeserialize: () => ({}),
		},
	},
	'Pusher',
);
interface LokiPusherClient extends Client {
	push(
		request: LokiStream[],
		metadata: Metadata,
		options: Partial<CallOptions>,
		callback: (err: ServiceError | null) => void,
	): void;
}

export const createGrpcPusher = ({
	host = LOKI_INGESTER_HOST,
	port = LOKI_INGESTER_GRPC_PORT,
} = {}): LokiPusher => {
	const compressionAlgorithm = LOKI_GRPC_SEND_GZIP
		? compressionAlgorithms.gzip
		: compressionAlgorithms.identity;
	const client = new PusherClient(
		`${host}:${port}`,
		credentials.createInsecure(),
		{
			'grpc.default_compression_algorithm': compressionAlgorithm,
			'grpc.default_compression_level': LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL,
		},
	) as unknown as LokiPusherClient;
	return {
		push: (orgId, streams, deadline) =>
			new Promise((resolve, reject) => {
				const metadata = new Metadata();
				metadata.add('x-scope-orgid', orgId);
				client.push(streams, metadata, { deadline }, (err) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			}),
		errorLabel: (err: ServiceError) =>
			err.code ? statusKeys[err.code] : 'UNDEFINED',
		isRetryable: (err: ServiceError) =>
			[status.UNAVAILABLE, status.RESOURCE_EXHAUSTED].includes(err.code ?? -1),
	};
};

/** A push that Loki answered with an error, `code` being the HTTP status */
export class LokiHttpPushError extends Error {
	public code;
	constructor(code: number, body: string) {
		super(`Loki push failed with status ${code}: ${body}`);
		this.code = code;
	}
}

// The HTTP statuses and connection errors that mean Loki is (temporarily) unavailable, like gRPC's UNAVAILABLE
const retryableHttpErrors = new Set<number | string>([
	502,
	503,
	504,
	'ECONNREFUSED',
	'ECONNRESET',
	'EPIPE',
]);
// The most of an error response's body to keep for its error message
const MAX_ERROR_BODY_LENGTH = 1024;

// snappy is only imported once pushing over HTTP, see the redis backend for why it isn't imported statically
const getSnappy = _.once(async () => await import('snappy'));

/**
 * Pushes to Loki's HTTP push API with snappy compressed protobuf bodies, Loki's default format. This costs the API
 * much less CPU per push than gRPC: an HTTP/1.1 request has far less per-call machinery than a grpc-js call, and
 * snappy is cheap enough that it costs about the same as sending the protobuf uncompressed, whereas gRPC's gzip
 * often costs more than the rest of the push.
 */
export const createHttpPusher = ({
	host = LOKI_INGESTER_HOST,
	port = LOKI_INGESTER_HTTP_PORT,
} = {}): LokiPusher => {
	const agent = new http.Agent({ keepAlive: true });
	return {
		push: async (orgId, streams, deadline) => {
			// Loki decodes protobuf push bodies as raw (block format) snappy. The sync version is used because snappy
			// compresses a push body faster than the async version's round trip through the threadpool
			const { compressSync } = await getSnappy();
			const body = compressSync(encodePushRequest(streams));
			await new Promise<void>((resolve, reject) => {
				const req = http.request(
					{
						agent,
						host,
						port,
						method: 'POST',
						path: '/loki/api/v1/push',
						headers: {
							'Content-Type': 'application/x-protobuf',
							'Content-Length': body.length,
							'X-Scope-OrgID': orgId,
						},
					},
					(res) => {
						res.on('error', reject);
						const statusCode = res.statusCode!;
						if (statusCode >= 200 && statusCode < 300) {
							res.resume();
							res.on('end', () => {
								clearTimeout(timeout);
								resolve();
							});
							return;
						}
						// Loki explains why it rejected a push in the response body
						let errorBody = '';
						res.setEncoding('utf8');
						res.on('data', (chunk: string) => {
							if (errorBody.length < MAX_ERROR_BODY_LENGTH) {
								errorBody += chunk;
							}
						});
						res.on('end', () => {
							clearTimeout(timeout);
							reject(
								new LokiHttpPushError(
									statusCode,
									errorBody.slice(0, MAX_ERROR_BODY_LENGTH).trim(),
								),
							);
						});
					},
				);
				const timeout = setTimeout(() => {
					req.destroy(
						Object.assign(new Error('Loki push timed out'), {
							code: 'ETIMEDOUT',
						}),
					);
				}, deadline - Date.now());
				req.on('error', (err) => {
					clearTimeout(timeout);
					reject(err);
				});
				req.end(body);
			});
		},
		errorLabel: (err: { code?: number | string }) =>
			typeof err.code === 'number'
				? `HTTP_${err.code}`
				: (err.code ?? 'UNDEFINED'),
		isRetryable: (err: { code?: number | string }) =>
			err.code != null && retryableHttpErrors.has(err.code),
	};
};
