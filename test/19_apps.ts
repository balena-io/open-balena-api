import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';

import type { UserObjectParam } from './test-lib/supertest.js';
import type { Application, Image, Release } from '../src/balena-model.js';
import { expectResourceToMatch } from './test-lib/api-helpers.js';
import type { PineTest } from 'pinejs-client-supertest';
import * as versions from './test-lib/versions.js';
import type { PickDeferred } from '@balena/abstract-sql-to-typescript';

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
				let supervisorImage2: PickDeferred<Image['Read']>;
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
					supervisorImage2 = fx.images.supervisorImage2;

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
					expect(supervisorApp1).to.deep.equal({
						id: supervisorApp.id,
						name: supervisorApp.app_name,
						is_host: false,
						class: 'app',
						releases: {
							[supervisorRelease2.commit]: {
								id: supervisorRelease2.id,
								services: {
									'resin-supervisor': {
										id: supervisorImage2.is_a_build_of__service.__id,
										image_id: supervisorImage2.id,
										image: supervisorImage2.is_stored_at__image_location,
										environment: {},
										labels: {},
									},
								},
							},
						},
					});
				});
			});

			describe('HostApps', () => {
				let fx: fixtures.Fixtures;
				let admin: UserObjectParam;
				let pineAdmin: PineTest;
				let userApp: Application['Read'];
				let intelNucHostApp: Application['Read'];
				let intelNucHostAppRelease1: Release['Read'];
				let intelNucHostAppImage1: PickDeferred<Image['Read']>;
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
					intelNucHostAppImage1 = fx.images.intelNucHostAppImage1;

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
					expect(stateGetHostApp).to.deep.equal({
						id: intelNucHostApp.id,
						name: intelNucHostApp.app_name,
						is_host: true,
						class: 'app',
						releases: {
							[intelNucHostAppRelease1.commit]: {
								id: intelNucHostAppRelease1.id,
								services: {
									main: {
										id: intelNucHostAppImage1.is_a_build_of__service.__id,
										image_id: intelNucHostAppImage1.id,
										image: intelNucHostAppImage1.is_stored_at__image_location,
										environment: {},
										labels: {
											'io.balena.image.store': 'root',
										},
									},
								},
							},
						},
					});
				});
			});
		});
	});
};
