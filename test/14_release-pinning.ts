import { expect } from './test-lib/chai';

import * as fakeDevice from './test-lib/fake-device';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';

import * as fixtures from './test-lib/fixtures';
import {
	addReleaseToApp,
	addImageToService,
	addServiceToApp,
	addImageToRelease,
} from './test-lib/api-helpers';

describe(`Tracking latest release`, () => {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	let application2Id: number;
	let application3Id: number;
	let appUuid: string;
	let app2Uuid: string;
	let app3Uuid: string;
	let device: fakeDevice.Device;
	let device2: fakeDevice.Device;
	let device3: fakeDevice.Device;

	before(async () => {
		fx = await fixtures.load('13-release-pinning');

		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;
		application2Id = fx.applications.app2.id;
		application3Id = fx.applications.app3.id;
		appUuid = fx.applications.app1.uuid;
		app2Uuid = fx.applications.app2.uuid;
		app3Uuid = fx.applications.app3.uuid;

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(admin, applicationId);
		device2 = await fakeDevice.provisionDevice(admin, application2Id);
		device3 = await fakeDevice.provisionDevice(admin, application3Id);
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('Should track latest release that is passing tests and final', async () => {
		const expectedLatest = fx.releases.release0;
		const state = await device.getStateV3();
		expect(state.local.apps[appUuid].releaseId).to.equal(expectedLatest.id);
	});

	it('Should allow pinning a device to a draft and untested release', async () => {
		const pinnedRelease = fx.releases.release1;
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({
				should_be_running__release: pinnedRelease.id,
			})
			.expect(200);
		const state = await device.getStateV3();
		expect(state.local.apps[appUuid].releaseId).to.equal(pinnedRelease.id);
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({
				should_be_running__release: null,
			})
			.expect(200);
	});

	it('Should not allow unexpected values for the release type', async () => {
		const expectedLatest = fx.releases.release2;
		await supertest(admin)
			.patch(`/${version}/release(${expectedLatest.id})`)
			.send({
				release_type: 'randomtype',
			})
			.expect(400, '"Check constraint violated"');
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
		const state = await device.getStateV3();
		expect(state.local.apps[appUuid].releaseId).to.equal(expectedLatest.id);
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
		const state = await device.getStateV3();
		expect(state.local.apps[appUuid].releaseId).to.equal(expectedLatest.id);
	});

	it('Should update latest release to previous final release passing tests', async () => {
		const expectedLatest = fx.releases.release2;
		await supertest(admin)
			.patch(`/${version}/release(${fx.releases.release3.id})`)
			.send({
				is_passing_tests: false,
			})
			.expect(200);
		const state = await device.getStateV3();
		expect(state.local.apps[appUuid].releaseId).to.equal(expectedLatest.id);
	});

	describe('given two releases of two applications building in parallel', function () {
		// used to create uqniue commits for each set of releases
		let testRunsCount = 0;
		let app1ReleaseId: number;
		let app2ReleaseId: number;

		beforeEach(async function () {
			testRunsCount++;

			const app1Release = await addReleaseToApp(admin, {
				belongs_to__application: applicationId,
				is_created_by__user: admin.id!,
				build_log: '',
				commit: `deadbeef${testRunsCount}`,
				composition: '',
				source: '',
				status: 'running',
				start_timestamp: Date.now(),
			});
			app1ReleaseId = app1Release.id;

			const app2Release = await addReleaseToApp(admin, {
				belongs_to__application: application2Id,
				is_created_by__user: admin.id!,
				build_log: '',
				commit: `deadbeef${testRunsCount}`,
				composition: '',
				source: '',
				status: 'running',
				start_timestamp: Date.now(),
			});
			app2ReleaseId = app2Release.id;
		});

		it('should update the target release of both apps when the releases complete in order', async function () {
			await supertest(admin)
				.patch(`/${version}/release(${app1ReleaseId})`)
				.send({
					status: 'success',
					end_timestamp: Date.now(),
				})
				.expect(200);

			await supertest(admin)
				.patch(`/${version}/release(${app2ReleaseId})`)
				.send({
					status: 'success',
					end_timestamp: Date.now(),
				})
				.expect(200);

			const device1state = await device.getStateV3();
			expect(device1state.local.apps[appUuid].releaseId).to.equal(
				app1ReleaseId,
			);
			const device2state = await device2.getStateV3();
			expect(device2state.local.apps[app2Uuid].releaseId).to.equal(
				app2ReleaseId,
			);
		});

		it('should update the target release of both apps when the the later release finishes before the first one', async function () {
			await supertest(admin)
				.patch(`/${version}/release(${app2ReleaseId})`)
				.send({
					status: 'success',
					end_timestamp: Date.now(),
				})
				.expect(200);

			await supertest(admin)
				.patch(`/${version}/release(${app1ReleaseId})`)
				.send({
					status: 'success',
					end_timestamp: Date.now(),
				})
				.expect(200);

			const device1state = await device.getStateV3();
			expect(device1state.local.apps[appUuid].releaseId).to.equal(
				app1ReleaseId,
			);
			const device2state = await device2.getStateV3();
			expect(device2state.local.apps[app2Uuid].releaseId).to.equal(
				app2ReleaseId,
			);
		});
	});

	describe('given an app that does not track the latest release', function () {
		let app3ReleaseId: number;

		before(async function () {
			await supertest(admin)
				.patch(`/${version}/application(${application3Id})`)
				.send({
					should_track_latest_release: false,
				})
				.expect(200);

			const app3Release = await addReleaseToApp(admin, {
				belongs_to__application: application3Id,
				is_created_by__user: admin.id!,
				build_log: '',
				commit: `deadbeef`,
				composition: '',
				source: '',
				status: 'running',
				start_timestamp: Date.now(),
			});
			app3ReleaseId = app3Release.id;

			const { id: serviceId } = await addServiceToApp(
				admin,
				'new-untracked-release-service',
				application3Id,
			);

			const { id: imageId } = await addImageToService(admin, {
				is_a_build_of__service: serviceId,
				build_log: '',
				start_timestamp: Date.now(),
				end_timestamp: Date.now(),
				push_timestamp: Date.now(),
				image_size: 1024,
				status: 'success',
			});
			await addImageToRelease(admin, imageId, app3ReleaseId);

			await supertest(admin)
				.patch(`/${version}/release(${app3ReleaseId})`)
				.send({
					status: 'success',
					end_timestamp: Date.now(),
				})
				.expect(200);
		});

		it('should not update the target release', async function () {
			const expectedApp3Latest = fx.releases.app3release1;
			const device3state = await device3.getStateV3();
			expect(device3state.local.apps[app3Uuid].releaseId).to.equal(
				expectedApp3Latest.id,
			);
		});

		it('should add any new service installs of the new release at the point it is actually pinned', async function () {
			const {
				body: { d: serviceInstallsBefore },
			} = await supertest(admin)
				.get(
					`/${version}/service_install?$select=id&$expand=installs__service($select=service_name)&$filter=device eq ${device3.id}`,
				)
				.expect(200);

			expect(serviceInstallsBefore).to.be.an('array');
			const serviceNamesBefore = serviceInstallsBefore.map(
				(si: AnyObject) => si.installs__service[0].service_name,
			);
			expect(serviceNamesBefore).to.not.include(
				'new-untracked-release-service',
			);

			await supertest(admin)
				.patch(`/${version}/application(${application3Id})`)
				.send({
					should_be_running__release: app3ReleaseId,
				})
				.expect(200);

			const {
				body: { d: serviceInstallsAfter },
			} = await supertest(admin)
				.get(
					`/${version}/service_install?$select=id&$expand=installs__service($select=service_name)&$filter=device eq ${device3.id}`,
				)
				.expect(200);

			expect(serviceInstallsAfter).to.be.an('array');
			const serviceNamesAfter = serviceInstallsAfter.map(
				(si: AnyObject) => si.installs__service[0].service_name,
			);
			expect(serviceNamesAfter).to.include('new-untracked-release-service');
		});
	});
});
