import _ from 'lodash';
import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import { supertest } from './test-lib/supertest.js';
import { DAYS } from '@balena/env-parsing';

const createLog = (extra = {}) => {
	return {
		isStdErr: true,
		isSystem: true,
		message: 'a log line',
		timestamp: Date.now(),
		...extra,
	};
};

export default () => {
	describe('device log', () => {
		const ctx: AnyObject = {};
		before(async () => {
			const fx = await fixtures.load('create-device-log');
			ctx.loadedFixtures = fx;
			ctx.user = fx.users.admin;
			ctx.device = fx.devices.device1;
			ctx.device2 = fx.devices.device2;

			const res = await supertest(ctx.user)
				.post(`/api-key/device/${ctx.device.id}/device-key`)
				.expect(200);

			expect(res.body).to.be.a('string');
			ctx.device.apiKey = res.body;

			const res2 = await supertest(ctx.user)
				.post('/api-key/user/full')
				.send({ name: 'name' })
				.expect(200);

			expect(res2.body).to.be.a('string');
			ctx.user.apiKey = res2.body;
		});
		after(() => fixtures.clean(ctx.loadedFixtures));

		// Creating

		it('should allow devices to write their own logs', () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send([createLog()])
				.expect(201));

		it('should allow devices to write many logs in a batch', () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send([createLog(), createLog()])
				.expect(201));

		it("should not allow devices to write other devices' logs", () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device2.uuid}/logs`)
				.send([createLog()])
				.expect(401));

		it('should accept and store batches where some logs have serviceId', () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send([createLog({ serviceId: 10 }), createLog()])
				.expect(201));

		it('should return 201 even when the list of logs is empty', () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send([])
				.expect(201));

		it('should ignore logs with uuid (from dependent devices)', () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send([createLog({ uuid: 'abcdef' })])
				.expect(201));

		it('should ignore unknown properties on logs and store them', () =>
			supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send([createLog({ hello: 'hi there' })])
				.expect(201));

		it('should reject batches with broken logs', async () => {
			for (const extra of [
				{ message: 123 },
				{ message: null },
				{ timestamp: new Date().toISOString() },
			]) {
				await supertest(ctx.device.apiKey)
					.post(`/device/v2/${ctx.device.uuid}/logs`)
					.send([createLog(extra)])
					.expect(400);
			}
		});

		// Reading Logs

		it('should allow users to read device logs with a JWT', async () => {
			const res = await supertest(ctx.user)
				.get(`/device/v2/${ctx.device.uuid}/logs`)
				.expect(200);

			expect(res.body).to.have.lengthOf(6);
			let lastTs = 0;
			(res.body as AnyObject[]).forEach((log, index) => {
				expect(log).to.have.property('message').that.equals('a log line');
				expect(log).to.have.property('isStdErr').that.equals(true);
				expect(log).to.have.property('isSystem').that.equals(true);
				expect(log).to.have.property('timestamp').that.is.a('number');
				expect(log).to.have.property('createdAt').that.is.a('number');
				// Validate they are sorted chronologically
				expect(log.createdAt).to.be.gte(lastTs);
				lastTs = log.createdAt;
				// The 4th is a service log and should have the correct serviceId
				if (index === 3) {
					expect(log).to.have.property('serviceId').that.equals(10);
				} else {
					expect(log).not.to.have.property('serviceId');
				}
			});
		});

		it('should allow users to read device logs with user-level API keys', async () => {
			const res = await supertest(ctx.user.apiKey)
				.get(`/device/v2/${ctx.device.uuid}/logs`)
				.expect(200);
			expect(res.body).to.have.lengthOf(6);
		});

		it('should support the `count` option in the custom read endpoint if available', async () => {
			const res = await supertest(ctx.user)
				.get(`/device/v2/${ctx.device.uuid}/logs?count=4`)
				.expect(200);
			expect(res.body).to.have.lengthOf(4);
			// Test that it's sending the latest 4 and not just any other 4 logs
			(res.body as AnyObject[]).forEach((log, index) => {
				if (index === 1) {
					expect(log).to.have.property('serviceId').that.equals(10);
				} else {
					expect(log).not.to.have.property('serviceId');
				}
			});
		});

		it('should support the `count=all` option in the custom read endpoint if available', async () => {
			const res = await supertest(ctx.user)
				.get(`/device/v2/${ctx.device.uuid}/logs?count=all`)
				.expect(200);
			expect(res.body).to.have.lengthOf(6);
		});

		it('should reject batches with more logs than allowed', async () => {
			const logs = _.times(11, createLog);
			await supertest(ctx.device.apiKey)
				.post(`/device/v2/${ctx.device.uuid}/logs`)
				.send(logs)
				.expect(400);
		});

		// Stream Reading Logs

		let dateBeforeStreamedLogs: Date;
		it('should allow users to stream-read device logs with a JWT', async () => {
			dateBeforeStreamedLogs = new Date();
			const logChunks: string[] = [];
			let extraLogsSent = 0;
			const req = supertest(ctx.user)
				.get(`/device/v2/${ctx.device.uuid}/logs`)
				.query({
					stream: 1,
					count: 2,
				})
				.expect('Content-type', 'application/octet-stream')
				.expect('Content-encoding', 'gzip')
				.parse(function (res, callback) {
					const chunks: Buffer[] = [];
					res.on('data', async (chunk) => {
						const parsedChunk = Buffer.from(chunk);
						chunks.push(parsedChunk);
						logChunks.push(parsedChunk.toString());

						// Emit 2 extra logs after retrieving the historical ones and stop listening.
						if (logChunks.length >= 3) {
							await req.abort();
							return;
						}
						// TODO: Change this to use the `/device/v2/:uuid/log-stream`` endpoint.
						await supertest(ctx.device.apiKey)
							.post(`/device/v2/${ctx.device.uuid}/logs`)
							.send([
								createLog({ message: `streamed log line ${extraLogsSent++}` }),
							])
							.expect(201);
					});
					res.on('end', () => {
						callback(null, Buffer.concat(chunks));
					});
				})
				.expect(200);

			try {
				await req;
				throw new Error('Stream-reading device logs unexpectedly succeeded!');
			} catch (error) {
				// Ignore abort errors, since we intentionally aborted
				// this infinitely streaming request.
				if (error.code !== 'ABORTED') {
					throw error;
				}
			}

			const logs = logChunks
				.flatMap((chunk) => chunk.split('\n'))
				.filter((l) => l !== '')
				.map((l) => JSON.parse(l) as ReturnType<typeof createLog>);

			expect(logs).to.have.lengthOf(4);
			expect(extraLogsSent).to.equal(2);
			expect(logs.map((l) => l.message)).to.deep.equal([
				'a log line',
				'a log line',
				'streamed log line 0',
				'streamed log line 1',
			]);
		});

		for (const fn of ['toISOString', 'getTime'] as const) {
			it(`should allow specifying logs start date as a ${fn}`, async () => {
				const res = await supertest(ctx.user)
					.get(
						`/device/v2/${ctx.device.uuid}/logs?start=${dateBeforeStreamedLogs[fn]()}`,
					)
					.expect(200);

				expect(res.body).to.have.lengthOf(2);
				expect(res.body[0])
					.to.have.property('message')
					.equals('streamed log line 0');
				expect(res.body[1])
					.to.have.property('message')
					.equals('streamed log line 1');

				// And double check that putting the date further back does fetch all the expected logs..
				const res2 = await supertest(ctx.user)
					.get(
						`/device/v2/${ctx.device.uuid}/logs?start=${new Date(dateBeforeStreamedLogs.getTime() - 1 * DAYS)[fn]()}`,
					)
					.expect(200);
				expect(res2.body).to.have.lengthOf(8);
			});
		}
	});
};
