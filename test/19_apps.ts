import mockery from 'mockery';
import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures';
import * as fakeDevice from './test-lib/fake-device';

import * as configMock from '../src/lib/config';
import type { UserObjectParam } from './test-lib/supertest';
import type { Application, Release } from '../src/balena-model';
import { expectResourceToMatch } from './test-lib/api-helpers';
import type { PineTest } from 'pinejs-client-supertest';
import * as versions from './test-lib/versions';

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
			let userApp: Application;
			let supervisorApp: Application;
			let supervisorRelease2: Release;
			let deviceWithSupervisor: fakeDevice.Device;
			let deviceWithoutSupervisor: fakeDevice.Device;

			before(async () => {
				mockery.registerMock('../src/lib/config', configMock);
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
				mockery.deregisterMock('../src/lib/config');
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
				expect(supervisorApp1).to.have.property('name', supervisorApp.app_name);
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

				expect(supervisorApp1, 'supervisor is undefined').to.not.be.undefined;
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
	});
});
