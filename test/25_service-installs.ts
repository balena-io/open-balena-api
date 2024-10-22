import { expect } from 'chai';

import * as fakeDevice from './test-lib/fake-device.js';
import * as versions from './test-lib/versions.js';

import * as fixtures from './test-lib/fixtures.js';

import { assertExists } from './test-lib/common.js';

export default () => {
	versions.test((version, pineTest) => {
		const pinnedOnReleaseField = versions.gt(version, 'v6')
			? 'is_pinned_on__release'
			: 'should_be_running__release';

		describe('should create service installs', () => {
			const ctx: AnyObject = {};
			let pineUser: typeof pineTest;

			before(async function () {
				const fx = await fixtures.load('25-service-installs');
				ctx.loadedFixtures = fx;
				ctx.admin = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: {
						user: ctx.admin,
					},
				});

				ctx.app1 = fx.applications.app1;
				ctx.app2 = fx.applications.app2;

				ctx.release = fx.releases.release1;
				ctx.release2 = fx.releases.release2;
				ctx.release3 = fx.releases.release3;

				ctx.app1Service1 = fx.services.app1Service1;
				ctx.app1Service2 = fx.services.app1Service2;
				ctx.app1Service3 = fx.services.app1Service3;
				ctx.app2Service1 = fx.services.app2Service1;
			});

			after(async () => {
				await fixtures.clean(ctx.loadedFixtures);
			});

			it('when a device is created', async () => {
				const device = await fakeDevice.provisionDevice(ctx.admin, ctx.app1.id);

				const { body: serviceInstalls } = await pineUser
					.get({
						resource: 'service_install',
						id: {
							device: device.id,
							installs__service: ctx.app1Service1.id,
						},
					})
					.expect(200);
				assertExists(serviceInstalls);
				expect(serviceInstalls.device.__id).to.equal(device.id);
				expect(serviceInstalls.installs__service.__id).to.equal(
					ctx.app1Service1.id,
				);
				ctx.device = device;
			});

			it('for pinning an application to a release', async () => {
				await pineUser
					.patch({
						resource: 'application',
						id: ctx.app1.id,
						body: {
							should_be_running__release:
								ctx.loadedFixtures.releases.release2.id,
						},
					})
					.expect(200);
				const { body: serviceInstalls } = await pineUser
					.get({
						resource: 'service_install',
						id: {
							device: ctx.device.id,
							installs__service: ctx.app1Service2.id,
						},
					})
					.expect(200);
				assertExists(serviceInstalls);
				expect(serviceInstalls.device.__id).to.equal(ctx.device.id);
				expect(serviceInstalls.installs__service.__id).to.equal(
					ctx.app1Service2.id,
				);
			});

			it('when a device is pinned on a different release', async () => {
				await pineUser
					.patch({
						resource: 'device',
						id: ctx.device.id,
						body: {
							[pinnedOnReleaseField]: ctx.release3.id,
						},
					})
					.expect(200);
				const { body: serviceInstalls } = await pineUser
					.get({
						resource: 'service_install',
						id: {
							device: ctx.device.id,
							installs__service: ctx.app1Service3.id,
						},
					})
					.expect(200);
				assertExists(serviceInstalls);
				expect(serviceInstalls.device.__id).to.equal(ctx.device.id);
				expect(serviceInstalls.installs__service.__id).to.equal(
					ctx.app1Service3.id,
				);
			});

			it('when device is moved to different application', async () => {
				await pineUser
					.patch({
						resource: 'device',
						id: ctx.device.id,
						body: {
							[pinnedOnReleaseField]: null,
						},
					})
					.expect(200);

				await pineUser
					.patch({
						resource: 'device',
						id: ctx.device.id,
						body: { belongs_to__application: ctx.app2.id },
					})
					.expect(200);

				const { body: serviceInstalls } = await pineUser
					.get({
						resource: 'service_install',
						id: {
							device: ctx.device.id,
							installs__service: ctx.app2Service1.id,
						},
					})
					.expect(200);
				assertExists(serviceInstalls);
				expect(serviceInstalls.device.__id).to.equal(ctx.device.id);
				expect(serviceInstalls.installs__service.__id).to.equal(
					ctx.app2Service1.id,
				);
			});
		});
	});
};
