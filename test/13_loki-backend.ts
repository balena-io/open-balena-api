import _ from 'lodash';
import pTimeout from 'p-timeout';
import { expect } from 'chai';
import { LokiBackend } from '../src/features/device-logs/lib/backends/loki.ts';
import { encodePushRequest } from '../src/features/device-logs/lib/backends/loki-push-request.ts';
import type { LokiStream } from '../src/features/device-logs/lib/backends/loki-push-request.ts';
import {
	createHttpPusher,
	LokiHttpPushError,
} from '../src/features/device-logs/lib/backends/loki-pushers.ts';
import { uncompressSync } from 'snappy';
import { getNanoTimestamp } from '../src/lib/utils.ts';
import type {
	InternalDeviceLog,
	LogContext,
	LokiLogContext,
	OutputDeviceLog,
} from '../src/features/device-logs/lib/struct.ts';
import { setTimeout } from 'timers/promises';
import { getMockServer } from './test-lib/mockttp-server.ts';

const createLog = (
	extra: Partial<InternalDeviceLog> = {},
): InternalDeviceLog => {
	const nanoTimestamp = extra.nanoTimestamp ?? getNanoTimestamp();
	return {
		isStdErr: true,
		isSystem: true,
		message: `a log line`,
		nanoTimestamp,
		timestamp: Date.now(),
		...extra,
	};
};
const convertToOutputLog = (log: InternalDeviceLog): OutputDeviceLog => {
	const { nanoTimestamp, ...outputLog } = log;
	return {
		...outputLog,
		createdAt: Math.floor(Number(nanoTimestamp / 1000000n)),
	};
};

const createContext = (extra = {}): LogContext & LokiLogContext => {
	return {
		id: 1,
		uuid: '1',
		appId: '1',
		orgId: '1',
		retention_limit: 100,
		...extra,
	};
};

const start = Date.now();

export default () => {
	describe('loki backend', () => {
		it('should successfully publish log', async () => {
			const loki = new LokiBackend();
			const response = await loki.publish(createContext(), [createLog()]);
			expect(response).to.be.not.null;
		});

		it('should store and retrieve device log', async () => {
			const loki = new LokiBackend();
			const ctx = createContext();
			const log = createLog();
			const response = await loki.publish(ctx, [_.clone(log)]);
			expect(response).to.be.not.null;
			const history = await loki.history(ctx, { count: 1000, start });
			expect(history.at(-1)).to.deep.equal(convertToOutputLog(log));
		});

		it('should push multiple logs with different labels and return in order', async function () {
			const loki = new LokiBackend();
			const ctx = createContext();
			const now = getNanoTimestamp();
			const logs = [
				createLog({ nanoTimestamp: now - 4n }),
				createLog({ nanoTimestamp: now - 3n }),
				createLog({ nanoTimestamp: now - 2n, isStdErr: false }),
				createLog({ nanoTimestamp: now - 1n, isStdErr: false }),
				createLog({ nanoTimestamp: now, isStdErr: false, isSystem: false }),
			];
			const response = await loki.publish(ctx, _.cloneDeep(logs));
			expect(response).to.be.not.null;
			const history = await loki.history(ctx, { count: 1000, start });
			expect(history.slice(-5)).to.deep.equal(logs.map(convertToOutputLog));
		});

		it('should de-duplicate multiple identical logs', async function () {
			const loki = new LokiBackend();
			const ctx = createContext();
			const log = createLog();
			const logs = [_.clone(log), _.clone(log), _.clone(log)];
			const response = await loki.publish(ctx, _.cloneDeep(logs));
			expect(response).to.be.not.null;
			const history = await loki.history(ctx, { count: 1000, start });
			expect(history[1].timestamp).to.not.equal(log.timestamp);
		});

		it('should subscribe and receive a published logs', async function () {
			const ctx = createContext();
			const loki = new LokiBackend();
			const log = createLog();
			const p = pTimeout(
				new Promise((resolve) => {
					loki.subscribe(ctx, resolve);
				}),
				{ milliseconds: 5000, message: 'Subscription did not receive log' },
			);
			await setTimeout(100); // wait for the subscription to connect
			await loki.publish(ctx, [_.clone(log)]);
			await p;
		});

		it('should subscribe and receive multiple published logs', async function () {
			const ctx = createContext({ belongs_to__application: 2 });
			const loki = new LokiBackend();
			const p = pTimeout(
				new Promise<void>((resolve) => {
					let countLogs = 0;
					loki.subscribe(ctx, () => {
						countLogs += 1;
						if (countLogs === 5) {
							resolve();
						}
					});
				}),
				{ milliseconds: 5000, message: 'Subscription did not receive logs' },
			);
			// let time pass after subscription so multiple logs with different times can be published
			await setTimeout(100);
			const now = getNanoTimestamp();
			const logs = [
				createLog({ nanoTimestamp: now - 4n }),
				createLog({ nanoTimestamp: now - 3n }),
				createLog({ nanoTimestamp: now - 2n, isStdErr: false }),
				createLog({ nanoTimestamp: now - 1n, isStdErr: false }),
				createLog({ nanoTimestamp: now, isStdErr: false, isSystem: false }),
			];
			await loki.publish(ctx, logs);
			await p;
		});
	});

	describe('loki push request encoding', () => {
		// The expected bytes were produced by serializing the same requests with google-protobuf (loki-grpc-client)
		const deviceMetadata = [{ name: 'device_id', value: '1' }];

		it('should encode a stream with one entry', () => {
			expect(
				encodePushRequest([
					{
						labels: '{fleet_id="1"}',
						entries: [
							{
								seconds: 1700000000,
								nanos: 123456789,
								line: '{"message":"a log line"}',
								structuredMetadata: deviceMetadata,
							},
						],
					},
				]).toString('hex'),
			).to.equal(
				'0a490a0e7b666c6565745f69643d2231227d12370a0b0880e2cfaa0610959aef3a12187b226d657373616765223a2261206c6f67206c696e65227d1a0e0a096465766963655f6964120131',
			);
		});

		it('should encode multiple streams, omitting empty fields and using multi-byte lengths', () => {
			expect(
				encodePushRequest([
					{
						labels: '{fleet_id="1"}',
						entries: [
							{
								seconds: 1700000000,
								nanos: 0,
								line: '',
								structuredMetadata: deviceMetadata,
							},
							{
								seconds: 1700000001,
								nanos: 1,
								line: 'ünïcödé 🎉',
								structuredMetadata: [
									{ name: 'device_id', value: '2' },
									{ name: 'service', value: 'main' },
								],
							},
						],
					},
					{
						labels: '{fleet_id="2"}',
						entries: [
							{
								seconds: 1,
								nanos: 999999999,
								line: 'x'.repeat(200),
								structuredMetadata: [],
							},
						],
					},
				]).toString('hex'),
			).to.equal(
				'0a690a0e7b666c6565745f69643d2231227d12180a060880e2cfaa061a0e0a096465766963655f6964120131123d0a080881e2cfaa0610011210c3bc6ec3af63c3b664c3a920f09f8e891a0e0a096465766963655f69641201321a0f0a077365727669636512046d61696e0ae8010a0e7b666c6565745f69643d2232227d12d5010a08080110ff93ebdc0312c801' +
					'78'.repeat(200),
			);
		});

		it('should encode an empty request', () => {
			expect(encodePushRequest([])).to.have.lengthOf(0);
		});
	});

	describe('loki http push', () => {
		const pushError = async (
			pusher: ReturnType<typeof createHttpPusher>,
			streams: LokiStream[],
			deadline = Date.now() + 1000,
		) => {
			try {
				await pusher.push('42', streams, deadline);
			} catch (err) {
				return err;
			}
			throw new Error('Expected the push to fail');
		};

		it('should store and retrieve device logs pushed over HTTP', async () => {
			const loki = new LokiBackend({ pusher: createHttpPusher() });
			const ctx = createContext();
			const log = createLog({ message: 'pushed over HTTP' });
			await loki.publish(ctx, [_.clone(log)]);
			const history = await loki.history(ctx, { count: 1000, start });
			expect(history.at(-1)).to.deep.equal(convertToOutputLog(log));
		});

		it('should fail with the status and message of a push that Loki rejects', async () => {
			const pusher = createHttpPusher();
			const err = await pushError(pusher, [
				{
					labels: '{fleet_id=}',
					entries: [
						{
							seconds: Math.floor(Date.now() / 1000),
							nanos: 0,
							line: '{"message":"a log line"}',
							structuredMetadata: [],
						},
					],
				},
			]);
			expect(err).to.be.instanceOf(LokiHttpPushError);
			expect(err).to.have.property('code', 400);
			expect(err.message).to.match(/^Loki push failed with status 400: \S/);
			expect(pusher.errorLabel(err)).to.equal('HTTP_400');
			expect(pusher.isRetryable(err)).to.equal(false);
		});

		describe('requests', () => {
			// The mock server stands in for Loki's push API, to check the requests and set the responses
			const createMockPusher = () =>
				createHttpPusher({ host: '127.0.0.1', port: getMockServer().port });
			const forPush = () => getMockServer().forPost('/loki/api/v1/push').once();

			const streams: LokiStream[] = [
				{
					labels: '{fleet_id="1"}',
					entries: [
						{
							seconds: 1700000000,
							nanos: 1,
							line: '{"message":"a log line"}',
							structuredMetadata: [{ name: 'device_id', value: '1' }],
						},
					],
				},
			];

			it('should push snappy compressed protobuf to the push API', async () => {
				const endpoint = await forPush().thenReply(204);
				await createMockPusher().push('42', streams, Date.now() + 1000);
				const requests = await endpoint.getSeenRequests();
				expect(requests).to.have.lengthOf(1);
				const [{ path, headers, body }] = requests;
				expect(path).to.equal('/loki/api/v1/push');
				expect(headers).to.have.property(
					'content-type',
					'application/x-protobuf',
				);
				expect(headers).to.have.property('x-scope-orgid', '42');
				expect(uncompressSync(body.buffer)).to.deep.equal(
					encodePushRequest(streams),
				);
			});

			it('should treat Loki being unavailable as retryable', async () => {
				await forPush().thenReply(503);
				const pusher = createMockPusher();
				const err = await pushError(pusher, streams);
				expect(err).to.have.property('code', 503);
				expect(pusher.isRetryable(err)).to.equal(true);
			});

			it('should fail pushes that are still waiting for a response at the deadline', async () => {
				await forPush().thenTimeout();
				const pusher = createMockPusher();
				const err = await pushError(pusher, streams, Date.now() + 100);
				expect(err).to.have.property('code', 'ETIMEDOUT');
				expect(pusher.errorLabel(err)).to.equal('ETIMEDOUT');
				expect(pusher.isRetryable(err)).to.equal(false);
			});
		});
	});
};
