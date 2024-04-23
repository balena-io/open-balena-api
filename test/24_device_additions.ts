import { expect } from 'chai';
import type { PineTest } from 'pinejs-client-supertest';
import * as fixtures from './test-lib/fixtures.js';
import { type UserObjectParam, supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';

export default () => {
	versions.test(function (version, pineTest) {
		const testOverallStatus = async (
			user: UserObjectParam,
			deviceId: number,
			overallStatus: string,
		) => {
			const {
				body: {
					d: [device],
				},
			} = await supertest(user)
				.get(
					`/${version}/device(${deviceId})?$select=overall_status,id,is_online,api_heartbeat_state,overall_progress`,
				)
				.expect(200);

			expect(device).to.have.property('overall_status', overallStatus);
		};

		describe('Device additions', function () {
			let pineUser: PineTest;
			const ctx: AnyObject = {};
			before(async () => {
				const fx = await fixtures.load('24-device-additions');
				ctx.loadedFixtures = fx;
				ctx.user = fx.users.admin;

				ctx.deviceUpdating = fx.devices.deviceUpdating;
				ctx.deviceVpnOnHeartbeatOnline = fx.devices.deviceVpnOnHeartbeatOnline;
				ctx.deviceVpnOnHeartbeatTimeout =
					fx.devices.deviceVpnOnHeartbeatTimeout;
				ctx.deviceVpnOnHeartbeatOffline =
					fx.devices.deviceVpnOnHeartbeatOffline;

				ctx.deviceVpnOffHeartbeatOnline =
					fx.devices.deviceVpnOffHeartbeatOnline;
				ctx.deviceVpnOffHeartbeatTimeout =
					fx.devices.deviceVpnOffHeartbeatTimeout;
				ctx.deviceVpnOffHeartbeatOffline =
					fx.devices.deviceVpnOffHeartbeatOffline;

				pineUser = pineTest.clone({ passthrough: { user: ctx.user } });

				// Turn the devices on & off, so that they are no longer configuring
				const vpnOfflineDevicesFilter = {
					id: {
						$in: [
							ctx.deviceVpnOffHeartbeatOnline,
							ctx.deviceVpnOffHeartbeatTimeout,
							ctx.deviceVpnOffHeartbeatOffline,
						].map((d) => d.id),
					},
				};
				await pineUser
					.patch({
						resource: 'device',
						options: {
							$filter: vpnOfflineDevicesFilter,
						},
						body: {
							is_online: true,
						},
					})
					.expect(200);

				await pineUser
					.patch({
						resource: 'device',
						options: {
							$filter: vpnOfflineDevicesFilter,
						},
						body: {
							is_online: false,
						},
					})
					.expect(200);
			});

			after(async () => {
				await fixtures.clean(ctx.loadedFixtures);
			});

			describe('overall_status & overall_progress', () => {
				describe('Given a device connected to the vpn', () => {
					it('should have an Idle overall_status when the heartbeat is Online', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceVpnOnHeartbeatOnline.id,
							'idle',
						);
					});

					it('should have an Idle overall_status when the heartbeat is Timeout', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceVpnOnHeartbeatTimeout.id,
							'idle',
						);
					});

					it('should have an Idle overall_status when the heartbeat is Offline', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceVpnOnHeartbeatOffline.id,
							'idle',
						);
					});
				});

				describe('Given a device disconnected from the vpn', () => {
					it('should have an Idle overall_status when the heartbeat is Online', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceVpnOffHeartbeatOnline.id,
							'idle',
						);
					});

					it('should have an Idle overall_status when the heartbeat is Timeout', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceVpnOffHeartbeatTimeout.id,
							'idle',
						);
					});

					it('should have an Offline overall_status when the heartbeat is Offline', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceVpnOffHeartbeatOffline.id,
							'offline',
						);
					});
				});

				describe('Given a device downloading a multicontainer release', () => {
					it('should properly calculate the overall_status', async () => {
						await testOverallStatus(
							ctx.user,
							ctx.deviceUpdating.id,
							'updating',
						);
					});

					it('should properly calculate the overall_progress', async () => {
						const {
							body: {
								d: [device],
							},
						} = await supertest(ctx.user)
							.get(
								`/${version}/device(${ctx.deviceUpdating.id})?$select=overall_progress`,
							)
							.expect(200);

						expect(device).to.have.property('overall_progress', 75);
					});
				});
			});
		});
	});
};
