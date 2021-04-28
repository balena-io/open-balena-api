import * as mockery from 'mockery';
import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import * as fakeDevice from './test-lib/fake-device';

import * as configMock from '../src/lib/config';
import { UserObjectParam } from './test-lib/supertest';

describe('Apps', function () {
	describe('Supervisor app', () => {
		let fx: fixtures.Fixtures;
		let admin: UserObjectParam;
		let applicationId: number;
		let supervisorAppUuid: string;
		let deviceWithSupervisor: fakeDevice.Device;
		let deviceWithoutSupervisor: fakeDevice.Device;

		before(async () => {
			mockery.registerMock('../src/lib/config', configMock);
			fx = await fixtures.load('17-apps');

			admin = fx.users.admin;
			applicationId = fx.applications.app1.id;

			supervisorAppUuid = fx.applications.supervisorApp.uuid;

			deviceWithSupervisor = await fakeDevice.provisionDevice(
				admin,
				applicationId,
				'balenaOS 2.3.0+rev1',
				'1.0.1',
			);
			deviceWithoutSupervisor = await fakeDevice.provisionDevice(
				admin,
				applicationId,
				'balenaOS 2.3.0+rev1',
				'3.1.4',
			);
		});

		after(async () => {
			await fixtures.clean({ devices: [deviceWithSupervisor] });
			await fixtures.clean(fx);
			mockery.deregisterMock('../src/lib/config');
		});

		it('should have a supervisor app if managed by release', async () => {
			const state = await deviceWithSupervisor.getStateV3();
			const supervisorApp1 = state.local.apps?.[`${supervisorAppUuid}`];

			expect(supervisorApp1, 'supervisor is undefined').to.not.be.undefined;
			expect(
				Object.keys(state.local.apps).length,
				'wrong number of apps',
			).to.be.equal(2);
		});

		it('should not have a supervisor app if not managed by release', async () => {
			const state = await deviceWithoutSupervisor.getStateV3();
			const supervisorApp1 = state.local.apps?.[`${supervisorAppUuid}`];

			expect(supervisorApp1, 'supervisor is undefined').to.be.undefined;
			expect(
				Object.keys(state.local.apps).length,
				'wrong number of apps',
			).to.be.equal(1);
		});
	});
});
