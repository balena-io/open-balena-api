import { expect } from './test-lib/chai';

import * as fakeDevice from './test-lib/fake-device';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';

import * as fixtures from './test-lib/fixtures';

describe(`Tracking latest release`, () => {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	let device: fakeDevice.Device;

	before(async () => {
		fx = await fixtures.load('13-release-pinning');

		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(admin, applicationId);
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('Should track latest release that is passing tests and final', async () => {
		const expectedLatest = fx.releases.release0;
		const state = await device.getState();
		expect(state.local.apps[applicationId].releaseId).to.equal(
			expectedLatest.id,
		);
	});

	it('Should allow pinning a device to a draft and untested release', async () => {
		const pinnedRelease = fx.releases.release1;
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({
				should_be_running__release: pinnedRelease.id,
			})
			.expect(200);
		const state = await device.getState();
		expect(state.local.apps[applicationId].releaseId).to.equal(
			pinnedRelease.id,
		);
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({
				should_be_running__release: null,
			})
			.expect(200);
	});

	it('Should update latest release to a newly-marked final release', async () => {
		const expectedLatest = fx.releases.release2;
		await supertest(admin)
			.patch(`/${version}/release(${expectedLatest.id})`)
			.send({
				release_type: 'final',
				start_timestamp: Date.now(),
			})
			.expect(200);
		const state = await device.getState();
		expect(state.local.apps[applicationId].releaseId).to.equal(
			expectedLatest.id,
		);
	});

	it('Should update latest release to a release now passing tests', async () => {
		const expectedLatest = fx.releases.release3;
		await supertest(admin)
			.patch(`/${version}/release(${expectedLatest.id})`)
			.send({
				is_passing_tests: true,
				start_timestamp: Date.now(),
			})
			.expect(200);
		const state = await device.getState();
		expect(state.local.apps[applicationId].releaseId).to.equal(
			expectedLatest.id,
		);
	});

	it('Should update latest release to previous final release passing tests', async () => {
		const expectedLatest = fx.releases.release2;
		await supertest(admin)
			.patch(`/${version}/release(${fx.releases.release3.id})`)
			.send({
				is_passing_tests: false,
			})
			.expect(200);
		const state = await device.getState();
		expect(state.local.apps[applicationId].releaseId).to.equal(
			expectedLatest.id,
		);
	});
});
