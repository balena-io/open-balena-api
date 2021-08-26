import { expect } from 'chai';

import * as fakeDevice from './test-lib/fake-device';
import { UserObjectParam } from './test-lib/supertest';

import * as fixtures from './test-lib/fixtures';

describe(`Tracking latest release`, () => {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	let device: fakeDevice.Device;

	before(async () => {
		fx = await fixtures.load('22-optional-services');

		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(admin, applicationId);
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('Should track latest release that is passing tests and final', async () => {
		const numServices = Object.keys(fx.services).length;
		const state = await device.getStateV2();
		expect(
			Object.keys(state.local.apps[applicationId].services),
		).to.have.lengthOf(numServices - 1);
	});
});
