import * as _ from 'lodash';
import { expect } from './test-lib/chai';
import { connectDeviceAndWaitForUpdate } from './test-lib/connect-device-and-wait';
import * as fakeDevice from './test-lib/fake-device';
import { UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import { pineTest } from './test-lib/pinetest';
import * as fixtures from './test-lib/fixtures';
import { Application } from '../src/balena-model';
import { sbvrUtils } from '@balena/pinejs';

describe(`Supervisor notification`, () => {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let pineUser: typeof pineTest;
	let app1: Application;
	let device: fakeDevice.Device;

	before(async () => {
		fx = await fixtures.load('20-supervisor-notification');

		admin = fx.users.admin;
		app1 = fx.applications.app1;
		pineUser = pineTest.clone({
			passthrough: { user: admin },
		});

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(
			admin,
			app1.id,
			'balenaOS 2.42.0+rev1',
			'9.11.1',
		);
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	[
		{
			resource: 'application_environment_variable',
			getNaturalKey: () => ({
				application: app1.id,
				name: 'testAppVar',
			}),
		},
		{
			resource: 'device_environment_variable',
			getNaturalKey: () => ({
				device: device.id,
				name: 'testDeviceVar',
			}),
		},
	].forEach(({ resource, getNaturalKey }) => {
		it(`should notify the supervisor after adding a ${resource}`, async function () {
			await connectDeviceAndWaitForUpdate(device.uuid, version, async () => {
				await pineUser
					.post({
						resource,
						body: {
							...getNaturalKey(),
							value: 'valueFromPOST',
						},
					})
					.expect(201);
			});
		});

		it(`should notify the supervisor after modifying a ${resource}`, async function () {
			await connectDeviceAndWaitForUpdate(device.uuid, version, async () => {
				await pineUser
					.patch({
						resource,
						id: getNaturalKey(),
						body: {
							value: 'valueFromPATCH',
						},
					})
					.expect(200);
			});
		});

		it(`should notify the supervisor deleting modifying a ${resource}`, async function () {
			await connectDeviceAndWaitForUpdate(device.uuid, version, async () => {
				await pineUser
					.delete({
						resource,
						id: getNaturalKey(),
					})
					.expect(200);
			});
		});
	});

	describe('given a big number of vars', function () {
		// See: https://www.postgresql.org/docs/13/protocol-message-formats.html#:~:text=The%20number%20of%20parameter%20values%20that%20follow
		const MAX_SAFE_SQL_BINDS = Math.pow(2, 16) - 1;
		const testVarsCount = MAX_SAFE_SQL_BINDS + 1;

		before(async function () {
			// Doing this with SQL, since otherwise simple pine requests would take very long.
			await sbvrUtils.db.executeSql(`
				INSERT INTO "device environment variable" ("device", "name", "value")
				SELECT ${device.id}, 'testDeviceVar_' || i, 'testValue'
				FROM GENERATE_SERIES(1,${testVarsCount}) i;
			`);

			const { body: varsCount } = await pineUser
				.get({
					resource: 'device_environment_variable',
					options: {
						$count: {
							$filter: {
								device: device.id,
							},
						},
					},
				})
				.expect(200);
			expect(varsCount).to.equal(testVarsCount);
		});

		after(async function () {
			// Manually deleted b/c the fixtures.clean() atm fails to delete them w/ a `code: '08P01'`.
			await sbvrUtils.db.executeSql(`
				DELETE FROM "device environment variable"
				WHERE "device" = ${device.id} AND "name" LIKE 'testDeviceVar_%'
			`);
		});

		// Just to confirm that the MAX_SAFE_SQL_BINDS limitation is still valid
		it('should fail when providing more parameters to $in than PG support', async function () {
			await pineUser
				.delete({
					resource: 'device_environment_variable',
					options: {
						$filter: {
							device: device.id,
							name: {
								$in: _.times(testVarsCount).map((i) => `testDeviceVar_${i}`),
							},
						},
					},
				})
				.expect(431);
		});

		it(`should notify the supervisor after deleting ${testVarsCount} device_environment_variables`, async function () {
			await connectDeviceAndWaitForUpdate(device.uuid, version, async () => {
				await pineUser
					.delete({
						resource: 'device_environment_variable',
						options: {
							$filter: {
								device: device.id,
							},
						},
					})
					.expect(200);
			});
			const { body: varsCount } = await pineUser
				.get({
					resource: 'device_environment_variable',
					options: {
						$count: {
							$filter: {
								device: device.id,
							},
						},
					},
				})
				.expect(200);
			expect(varsCount).to.equal(0);
		});
	});
});
