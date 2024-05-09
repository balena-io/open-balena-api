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

			const itShouldHaveOverallStatus = (
				testCase: string,
				deviceName: string,
				overallStatus: string,
			) => {
				it(testCase.replace('${OVERALL_STATUS}', overallStatus), async () => {
					await testOverallStatus(ctx.user, ctx[deviceName].id, overallStatus);
				});
			};

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
				ctx.deviceWithDeviceConfigVPNDisabled =
					fx.devices.deviceWithDeviceConfigVPNDisabled;
				ctx.deviceWithApplicationConfigVPNDisabled =
					fx.devices.deviceWithApplicationConfigVPNDisabled;
				ctx.deviceWithDeviceConfigVPNEnabled =
					fx.devices.deviceWithDeviceConfigVPNEnabled;

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
					itShouldHaveOverallStatus(
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online',
						'deviceVpnOnHeartbeatOnline',
						versions.gt(version, 'v6') ? 'operational' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have a ${OVERALL_STATUS} overall_status when the heartbeat is Timeout',
						'deviceVpnOnHeartbeatTimeout',
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have a ${OVERALL_STATUS} overall_status when the heartbeat is Offline',
						'deviceVpnOnHeartbeatOffline',
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
					);
				});

				describe('Given a device disconnected from the vpn', () => {
					itShouldHaveOverallStatus(
						'should have a ${OVERALL_STATUS} overall_status when the heartbeat is Online',
						'deviceVpnOffHeartbeatOnline',
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have a ${OVERALL_STATUS} overall_status when the heartbeat is Timeout',
						'deviceVpnOffHeartbeatTimeout',
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is false',
						'deviceWithDeviceConfigVPNDisabled',
						versions.gt(version, 'v6') ? 'operational' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is true',
						'deviceWithDeviceConfigVPNEnabled',
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is false in application config variables',
						'deviceWithApplicationConfigVPNDisabled',
						versions.gt(version, 'v6') ? 'operational' : 'idle',
					);

					itShouldHaveOverallStatus(
						'should have a ${OVERALL_STATUS} overall_status when the heartbeat is Offline',
						'deviceVpnOffHeartbeatOffline',
						versions.gt(version, 'v6') ? 'disconnected' : 'offline',
					);
				});

				describe('Given a device downloading a multicontainer release', () => {
					itShouldHaveOverallStatus(
						'should properly calculate the overall_status',
						'deviceUpdating',
						'updating',
					);

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
