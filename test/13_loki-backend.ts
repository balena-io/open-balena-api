import _ from 'lodash';
import Bluebird from 'bluebird';
import { expect } from 'chai';
import { LokiBackend } from '../src/features/device-logs/lib/backends/loki';
import { getNanoTimestamp } from '../src/lib/utils';
import { LokiLogContext } from '../src/features/device-logs/lib/struct';
import { setTimeout } from 'timers/promises';

const createLog = (extra = {}) => {
	return {
		isStdErr: true,
		isSystem: true,
		message: `a log line`,
		nanoTimestamp: getNanoTimestamp(),
		timestamp: Date.now(),
		createdAt: Date.now(),
		...extra,
	};
};

const createContext = (extra = {}): LokiLogContext => {
	return {
		id: 1,
		uuid: '1',
		belongs_to__application: 1,
		retention_limit: 100,
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
		expect(history.at(-1)).to.deep.equal(log);
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
			1,
			'should be 1 stream since all logs share the same device id',
		);
		// @ts-expect-error usage of private function
		const logsFromStreams = loki.fromStreamsToDeviceLogs(streams);
		expect(logsFromStreams).to.deep.equal(logs);
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
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			loki.subscribe(ctx, resolve);
			await setTimeout(100); // wait for the subscription to connect
			await loki.publish(ctx, [_.clone(log)]);
		}).timeout(5000, 'Subscription did not receive log');
		expect(incomingLog).to.deep.equal(incomingLog);
	});

	it('should subscribe and receive multiple published logs', async function () {
		const ctx = createContext({ belongs_to__application: 2 });
		const loki = new LokiBackend();
		await new Bluebird(async (resolve) => {
			let countLogs = 0;
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			loki.subscribe(ctx, () => {
				countLogs += 1;
				if (countLogs === 5) {
					resolve();
				}
			});
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
		}).timeout(5000, 'Subscription did not receive logs');
	});
});
