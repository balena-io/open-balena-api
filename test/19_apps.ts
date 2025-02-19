import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';

import type { UserObjectParam } from './test-lib/supertest.js';
import type {
	Application,
	Release,
} from '@balena/open-balena-api/models/balena-model.d.ts';
import { expectResourceToMatch } from './test-lib/api-helpers.js';
import type { PineTest } from 'pinejs-client-supertest';
import * as versions from './test-lib/versions.js';
import { assertExists } from './test-lib/common.js';

export default () => {
	versions.test((version, pineTest) => {
		if (!versions.gt(version, 'v6')) {
			// Supervisor releases were added after v6
			return;
		}
		describe('Apps', function () {
			describe('Supervisor app', () => {
				let fx: fixtures.Fixtures;
				let admin: UserObjectParam;
				let pineAdmin: PineTest;
				let userApp: Application['Read'];
				let supervisorApp: Application['Read'];
				let supervisorRelease2: Release['Read'];
				let deviceWithSupervisor: fakeDevice.Device;
				let deviceWithoutSupervisor: fakeDevice.Device;

				before(async () => {
					fx = await fixtures.load('19-apps');

					admin = fx.users.admin;
					pineAdmin = pineTest.clone({
						passthrough: {
							user: admin,
						},
					});
					userApp = fx.applications.app1;
					supervisorApp = fx.applications.supervisorApp;
					supervisorRelease2 = fx.releases.supervisorRelease2;

					deviceWithSupervisor = await fakeDevice.provisionDevice(
						admin,
						userApp.id,
						'balenaOS 2.3.0+rev1',
						'1.0.1',
					);
					await expectResourceToMatch(
						pineAdmin,
						'device',
						deviceWithSupervisor.id,
						{
							should_be_managed_by__release: { __id: supervisorRelease2.id },
						},
					);
					deviceWithoutSupervisor = await fakeDevice.provisionDevice(
						admin,
						userApp.id,
						'balenaOS 2.3.0+rev1',
						'3.1.4',
					);
					await expectResourceToMatch(
						pineAdmin,
						'device',
						deviceWithoutSupervisor.id,
						{
							should_be_managed_by__release: null,
						},
					);
				});

				after(async () => {
					await fixtures.clean({ devices: [deviceWithSupervisor] });
					await fixtures.clean(fx);
				});

				it('should have a supervisor app if managed by release', async () => {
					const state = await deviceWithSupervisor.getStateV3();
					expect(
						Object.keys(state[deviceWithSupervisor.uuid].apps).sort(),
						'wrong number of apps',
					).to.deep.equal([supervisorApp.uuid, userApp.uuid].sort());

					expect(state[deviceWithSupervisor.uuid].apps)
						.to.have.property(supervisorApp.uuid)
						.that.is.an('object');
					const supervisorApp1 =
						state[deviceWithSupervisor.uuid].apps?.[supervisorApp.uuid];
					assertExists(supervisorApp1);
					expect(supervisorApp1).to.have.property(
						'name',
						supervisorApp.app_name,
					);
					expect(supervisorApp1).to.have.property('is_host', false);
					expect(supervisorApp1).to.have.property('class', 'app');
					expect(supervisorApp1)
						.to.have.nested.property('releases')
						.that.has.property(supervisorRelease2.commit)
						.that.is.an('object');
					expect(supervisorApp1.releases?.[supervisorRelease2.commit])
						.to.have.property('services')
						.that.has.property('resin-supervisor')
						.that.is.an('object');
				});

				it('should not have a supervisor app if not managed by release', async () => {
					const state = await deviceWithoutSupervisor.getStateV3();
					expect(
						Object.keys(state[deviceWithoutSupervisor.uuid].apps),
						'wrong number of apps',
					).to.deep.equal([userApp.uuid]);

					expect(
						state[deviceWithoutSupervisor.uuid].apps,
						'supervisor app should not be included',
					).to.not.have.property(supervisorApp.uuid);
				});
			});

			describe('HostApps', () => {
				let fx: fixtures.Fixtures;
				let admin: UserObjectParam;
				let pineAdmin: PineTest;
				let userApp: Application['Read'];
				let intelNucHostApp: Application['Read'];
				let intelNucHostAppRelease1: Release['Read'];
				let deviceWithHostApp: fakeDevice.Device;
				let deviceWithoutHostApp: fakeDevice.Device;

				before(async () => {
					fx = await fixtures.load('19-apps');

					admin = fx.users.admin;
					pineAdmin = pineTest.clone({
						passthrough: {
							user: admin,
						},
					});
					userApp = fx.applications.app1;
					intelNucHostApp = fx.applications['intel-nuc'];
					intelNucHostAppRelease1 = fx.releases.intelNucHostAppRelease1;

					deviceWithHostApp = await fakeDevice.provisionDevice(
						admin,
						userApp.id,
						'balenaOS 2.50.1+rev1',
					);
					await expectResourceToMatch(
						pineAdmin,
						'device',
						deviceWithHostApp.id,
						{
							should_be_operated_by__release: {
								__id: intelNucHostAppRelease1.id,
							},
						},
					);
					deviceWithoutHostApp = await fakeDevice.provisionDevice(
						admin,
						userApp.id,
						'balenaOS 2.3.0+rev1',
					);
					await expectResourceToMatch(
						pineAdmin,
						'device',
						deviceWithoutHostApp.id,
						{
							should_be_operated_by__release: null,
						},
					);
				});

				after(async () => {
					await fixtures.clean({ devices: [deviceWithHostApp] });
					await fixtures.clean(fx);
				});

				it('should have a host app if operated by a release', async () => {
					const state = await deviceWithHostApp.getStateV3();
					expect(
						Object.keys(state[deviceWithHostApp.uuid].apps).sort(),
						'wrong number of apps',
					).to.deep.equal([intelNucHostApp.uuid, userApp.uuid].sort());

					expect(state[deviceWithHostApp.uuid].apps)
						.to.have.property(intelNucHostApp.uuid)
						.that.is.an('object');
					const stateGetHostApp =
						state[deviceWithHostApp.uuid].apps?.[intelNucHostApp.uuid];
					assertExists(stateGetHostApp);
					expect(stateGetHostApp).to.have.property(
						'name',
						intelNucHostApp.app_name,
					);
					expect(stateGetHostApp).to.have.property('is_host', true);
					expect(stateGetHostApp).to.have.property('class', 'app');
					expect(stateGetHostApp)
						.to.have.nested.property('releases')
						.that.has.property(intelNucHostAppRelease1.commit)
						.that.is.an('object');
					expect(stateGetHostApp.releases?.[intelNucHostAppRelease1.commit])
						.to.have.property('services')
						.that.has.property('main')
						.that.is.an('object')
						.and.has.property('labels')
						.that.has.property('io.balena.image.store', 'root');
				});

				it('should not have a host app if not operated by a release', async () => {
					const state = await deviceWithoutHostApp.getStateV3();
					expect(
						Object.keys(state[deviceWithoutHostApp.uuid].apps),
						'wrong number of apps',
					).to.deep.equal([userApp.uuid]);

					expect(
						state[deviceWithoutHostApp.uuid].apps,
						'host app should not be included',
					).to.not.have.property(intelNucHostApp.uuid);
				});
			});
		});
	});
};
