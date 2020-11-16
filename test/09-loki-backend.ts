import _ = require('lodash');
import * as Bluebird from 'bluebird';
import { expect } from './test-lib/chai';
import { LokiBackend } from '../src/features/device-logs/lib/backends/loki';
import { DeviceLogsUsageMeter } from '../src/features/device-logs/lib/struct';

const createLog = (extra = {}) => {
	return {
		isStdErr: true,
		isSystem: true,
		message: `a log line`,
		timestamp: Date.now(),
		createdAt: Date.now(),
		...extra,
	};
};

const createContext = (extra = {}) => {
	return {
		id: 1,
		uuid: '1',
		belongs_to__application: 1,
		images: [],
		...extra,
	};
};

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
		const history = await loki.history(ctx, 1000);
		expect(history[history.length - 1]).to.deep.equal(log);
	});

	it('should convert multiple logs with different labels to streams and then back to logs', function () {
		const loki = new LokiBackend();
		const ctx = createContext();
		const logs = [
			createLog(),
			createLog(),
			createLog({ serviceId: 1 }),
			createLog({ serviceId: 2 }),
			createLog({ serviceId: 3 }),
		];
		// @ts-expect-error usage of private function
		const streams = loki.fromDeviceLogsToStreams(ctx, _.cloneDeep(logs));
		expect(streams.length).to.be.equal(
			4,
			'should be 4 streams since 5 logs have 4 distinct services (null, 1, 2, 3)',
		);
		// @ts-expect-error usage of private function
		const logsFromStreams = loki.fromStreamsToDeviceLogs(streams);
		expect(logsFromStreams).to.deep.equal(logs);
	});

	it('should push multiple logs with different labels and return in order', async function () {
		const loki = new LokiBackend();
		const ctx = createContext();
		const logs = [
			createLog({ timestamp: Date.now() - 4 }),
			createLog({ timestamp: Date.now() - 3 }),
			createLog({ timestamp: Date.now() - 2, isStdErr: false }),
			createLog({ timestamp: Date.now() - 1, isStdErr: false }),
			createLog({ timestamp: Date.now(), isStdErr: false, isSystem: false }),
		];
		const response = await loki.publish(ctx, _.cloneDeep(logs));
		expect(response).to.be.not.null;
		const history = await loki.history(ctx, 1000);
		expect(history.slice(-5)).to.deep.equal(logs);
	});

	it('should de-duplicate multiple identical logs', async function () {
		const loki = new LokiBackend();
		const ctx = createContext();
		const log = createLog();
		const logs = [_.clone(log), _.clone(log), _.clone(log)];
		const response = await loki.publish(ctx, _.cloneDeep(logs));
		expect(response).to.be.not.null;
		const history = await loki.history(ctx, 1000);
		expect(history[1].timestamp).to.not.equal(log.timestamp);
	});

	it('should subscribe and receive a published logs', async function () {
		const ctx = createContext();
		const loki = new LokiBackend();
		const log = createLog();
		const incomingLog = await new Bluebird(async (resolve) => {
			loki.subscribe(ctx, resolve);
			await Bluebird.delay(100); // wait for the subscription to connect
			loki.publish(ctx, [_.clone(log)]);
		}).timeout(5000, 'Subscription did not receive log');
		expect(incomingLog).to.deep.equal(incomingLog);
	});

	it('should subscribe and receive multiple published logs', async function () {
		const ctx = createContext({ belongs_to__application: 2 });
		const loki = new LokiBackend();
		await new Bluebird(async (resolve) => {
			let countLogs = 0;
			loki.subscribe(ctx, () => {
				countLogs += 1;
				if (countLogs === 5) {
					resolve();
				}
			});
			// let time pass after subscription so multiple logs with different times can be published
			await Bluebird.delay(100);
			const now = Date.now();
			const logs = [
				createLog({ timestamp: now - 4 }),
				createLog({ timestamp: now - 3 }),
				createLog({ timestamp: now - 2, isStdErr: false }),
				createLog({ timestamp: now - 1, isStdErr: false }),
				createLog({ timestamp: now, isStdErr: false, isSystem: false }),
			];
			await loki.publish(ctx, logs);
		}).timeout(5000, 'Subscription did not receive logs');
	});

	it('should call usageMeter after successful publish', async function () {
		const loki = new LokiBackend();
		const ctx = createContext();
		const logs = [
			createLog({ serviceId: 1 }),
			createLog({ serviceId: 2 }),
			createLog({ serviceId: 3 }),
		];
		const size = logs.reduce(
			(sum, log) => sum + Buffer.byteLength(log.message),
			0,
		);
		await new Bluebird(async (resolve) => {
			const meter: DeviceLogsUsageMeter = {
				incrementBytesRetained: (_ctx, bytes: number) => {
					if (size !== bytes) {
						throw new Error('Retained bytes does not match expected size');
					} else {
						loki.detachUsageMeter(); // detach to prevent multiple calls due to subsequent tests
						resolve();
					}
				},
			};
			loki.attachUsageMeter(meter);
			await loki.publish(ctx, logs);
		}).timeout(1000, 'Usage meter not called');
	});
});
