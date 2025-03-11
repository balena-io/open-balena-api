import _ from 'lodash';
import pTimeout from 'p-timeout';
import { expect } from 'chai';
import { LokiBackend } from '../src/features/device-logs/lib/backends/loki.js';
import { getNanoTimestamp } from '../src/lib/utils.js';
import type {
	InternalDeviceLog,
	LokiLogContext,
	OutputDeviceLog,
} from '../src/features/device-logs/lib/struct.js';
import { setTimeout } from 'timers/promises';

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

const createContext = (extra = {}): LokiLogContext => {
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
					void loki.subscribe(ctx, resolve);
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
					void loki.subscribe(ctx, () => {
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
};
