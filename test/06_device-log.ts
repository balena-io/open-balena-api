import _ from 'lodash';
import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures';
import { supertest } from './test-lib/supertest';

const createLog = (extra = {}) => {
	return {
		isStdErr: true,
		isSystem: true,
		message: 'a log line',
		timestamp: Date.now(),
		...extra,
	};
};

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
			// Yields 404 because fetching device2 by uuid yields nothing
			.expect(404));

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
	(
		[
			['users to read device logs with a JWT', () => ctx.user],
			['devices to read their device logs', () => ctx.device.apiKey],
		] as const
	).forEach(([description, getAuth]) => {
		it(`should allow ${description}`, async () => {
			const res = await supertest(getAuth())
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

	it('should reject batches with more logs than allowed', () => {
		const logs = _.times(11, createLog);
		return supertest(ctx.device.apiKey)
			.post(`/device/v2/${ctx.device.uuid}/logs`)
			.send(logs)
			.expect(400);
	});
});
