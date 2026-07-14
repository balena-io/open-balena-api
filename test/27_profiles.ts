import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import { pineTest } from './test-lib/pinetest.js';
import type { StateV3 } from '../src/features/device-state/routes/state-get-v3.js';

export default () => {
	describe('profiles', () => {
		let fx: fixtures.Fixtures;
		let admin: UserObjectParam;
		let pineUser: (typeof pineTest)['resin'];
		let userApp: fixtures.Fixtures['applications'][string];
		let hostApp: fixtures.Fixtures['applications'][string];
		let device: fakeDevice.Device;

		const getServiceNames = (
			state: StateV3,
			appUuid: string,
			commit: string,
		): string[] =>
			Object.keys(
				state[device.uuid].apps[appUuid]?.releases?.[commit]?.services ?? {},
			).sort();

		const expectStateServices = async ({
			userServices,
			hostServices,
		}: {
			userServices: string[];
			hostServices: string[];
		}) => {
			const state = await fakeDevice.getState(device, device.uuid, 'v3');
			expect(
				getServiceNames(state, userApp.uuid, 'userc0de'),
				'user app services',
			).to.deep.equal(userServices.sort());
			expect(
				getServiceNames(state, hostApp.uuid, 'hostc0de'),
				'hostapp services',
			).to.deep.equal(hostServices.sort());
		};

		before(async () => {
			fx = await fixtures.load('27-profiles');
			admin = fx.users.admin;
			pineUser = pineTest.resin.clone({
				passthrough: {
					user: admin,
				},
			});
			userApp = fx.applications['user-app'];
			hostApp = fx.applications['nuc-hostapp'];
			device = await fakeDevice.provisionDevice(admin, userApp.id);
			await pineUser.patch({
				resource: 'device',
				id: device.id,
				body: {
					is_pinned_on__release: fx.releases.userRelease.id,
					should_be_operated_by__release: fx.releases.hostappRelease.id,
				},
			});
		});

		after(async () => {
			await fixtures.clean({ devices: [device] });
			await fixtures.clean(fx);
		});

		it('should hide profiled services on every app by default (hostapp ext-bluetooth and user-app ext-metrics)', async () => {
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp'],
			});
		});

		it('should include profiled hostapp extension services once the hostapp fleet activates their profile', async () => {
			await pineUser.post({
				resource: 'application_profile',
				body: {
					application: hostApp.id,
					activates__profile_name: 'bluetooth',
					on__application: hostApp.id,
				},
			});
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp', 'ext-bluetooth'],
			});
		});

		it('should give device activated profiles priority over the fleet ones', async () => {
			// The device set fully replaces the fleet set, so activating an
			// unrelated profile here turns `bluetooth` back off.
			await pineUser.post({
				resource: 'device_profile',
				body: {
					device: device.id,
					profile_name: 'other',
					application: hostApp.id,
				},
			});
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp'],
			});
		});

		it('should support explicitly deactivating all profiles on the device for a specific application', async () => {
			await pineUser.delete({
				resource: 'device_profile',
				options: {
					$filter: { device: device.id },
				},
			});
			// `profile_name: null` is the override row -- no separate resource, see
			// spec2.md's "overrides with empty profile problem".
			await pineUser.post({
				resource: 'device_profile',
				body: {
					device: device.id,
					profile_name: null,
					application: hostApp.id,
				},
			});
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp'],
			});
		});

		it('should fall back to the fleet activated profiles once the device stops overriding them', async () => {
			await pineUser.delete({
				resource: 'device_profile',
				options: {
					$filter: {
						device: device.id,
						application: hostApp.id,
						profile_name: null,
					},
				},
			});
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp', 'ext-bluetooth'],
			});
		});

		it('should apply the hostapp fleet activated profiles to the fleet state', async () => {
			const { body: state } = await supertest(admin)
				.get(`/device/v3/fleet/${hostApp.uuid}/state`)
				.expect(200);
			expect(
				Object.keys(
					state[hostApp.uuid].apps[hostApp.uuid].releases['hostc0de'].services,
				).sort(),
			).to.deep.equal(['ext-bluetooth', 'hostapp']);
		});

		it('should not allow a device to create its own device profiles', async () => {
			await supertest(device)
				.post('/resin/device_profile')
				.send({
					device: device.id,
					profile_name: 'sneaky',
					application: hostApp.id,
				})
				.expect(401);
		});

		it('should allow a device to read its activated profiles', async () => {
			await pineUser.post({
				resource: 'device_profile',
				body: {
					device: device.id,
					profile_name: 'bluetooth',
					application: hostApp.id,
				},
			});
			const { body } = await supertest(device)
				.get(
					`/resin/device_profile?$filter=device eq ${device.id}&$select=profile_name`,
				)
				.expect(200);
			expect(body.d).to.deep.equal([{ profile_name: 'bluetooth' }]);
		});

		it('should gate a profiled user-app service on the user-app fleet activations, without affecting the hostapp', async () => {
			// Same generic mechanism as the hostapp, but targeting the device's own
			// user app (`should_be_running__release`). Activating `metrics` on the
			// user app reveals ext-metrics there and leaves the hostapp untouched.
			await pineUser.post({
				resource: 'application_profile',
				body: {
					application: userApp.id,
					activates__profile_name: 'metrics',
					on__application: userApp.id,
				},
			});
			await expectStateServices({
				userServices: ['main', 'ext-metrics'],
				hostServices: ['hostapp', 'ext-bluetooth'],
			});
		});

		it('should let a device override user-app profiles independently of its hostapp profiles', async () => {
			// A device activation targeting the user app replaces only the user-app
			// fleet set; the hostapp keeps resolving against its own device set.
			await pineUser.post({
				resource: 'device_profile',
				body: {
					device: device.id,
					profile_name: 'none',
					application: userApp.id,
				},
			});
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp', 'ext-bluetooth'],
			});
		});

		it('should let a device override one application with no profiles while another application keeps resolving its own device set', async () => {
			// Replace the user-app's `none` device activation with an explicit
			// empty override (`profile_name: null`), scoped only to the user app.
			// The hostapp's own device activation (`bluetooth`) must be unaffected.
			await pineUser.delete({
				resource: 'device_profile',
				options: {
					$filter: { device: device.id, application: userApp.id },
				},
			});
			await pineUser.post({
				resource: 'device_profile',
				body: {
					device: device.id,
					profile_name: null,
					application: userApp.id,
				},
			});
			await expectStateServices({
				userServices: ['main'],
				hostServices: ['hostapp', 'ext-bluetooth'],
			});
			await pineUser.delete({
				resource: 'device_profile',
				options: {
					$filter: {
						device: device.id,
						application: userApp.id,
						profile_name: null,
					},
				},
			});
		});

		it('should gate profiled services on a non-host fleet state too', async () => {
			const { body: state } = await supertest(admin)
				.get(`/device/v3/fleet/${userApp.uuid}/state?releaseUuid=userc0de`)
				.expect(200);
			expect(
				Object.keys(
					state[userApp.uuid].apps[userApp.uuid].releases['userc0de'].services,
				).sort(),
			).to.deep.equal(['ext-metrics', 'main']);
		});
	});
};
