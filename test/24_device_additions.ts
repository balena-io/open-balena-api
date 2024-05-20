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

		const testOverallProgress = async (
			user: UserObjectParam,
			deviceId: number,
			overallProgress: number,
		) => {
			const {
				body: {
					d: [device],
				},
			} = await supertest(user)
				.get(`/${version}/device(${deviceId})?$select=overall_progress`)
				.expect(200);

			expect(device).to.have.property('overall_progress', overallProgress);
		};

		describe('Device additions', function () {
			let pineUser: PineTest;
			const ctx: AnyObject = {};

			const itShouldHaveOverallStatus = (
				overallStatus: string,
				restTitle: string,
				deviceName: string,
			) => {
				it(`should have overall_status = "${overallStatus}" ${restTitle}`, async () => {
					await testOverallStatus(ctx.user, ctx[deviceName].id, overallStatus);
				});
			};

			const itShouldHaveOverallProgress = (
				overallProgress: number,
				title: string,
				deviceName: string,
			) => {
				it(title, async () => {
					await testOverallProgress(
						ctx.user,
						ctx[deviceName].id,
						overallProgress,
					);
				});
			};

			before(async () => {
				const fx = await fixtures.load('24-device-additions');
				ctx.loadedFixtures = fx;
				ctx.user = fx.users.admin;

				ctx.deviceUpdating = fx.devices.deviceUpdating;
				ctx.deviceUpdatingVPNOnly = fx.devices.deviceUpdatingVPNOnly;
				ctx.deviceUpdatingHeartbeatOnly =
					fx.devices.deviceUpdatingHeartbeatOnly;
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
				ctx.deviceVpnOffHeartbeatTimeoutVPNDisabled =
					fx.devices.deviceVpnOffHeartbeatTimeoutVPNDisabled;
				ctx.deviceWithDeviceConfigVPNDisabled =
					fx.devices.deviceWithDeviceConfigVPNDisabled;
				ctx.deviceWithApplicationConfigVPNDisabled =
					fx.devices.deviceWithApplicationConfigVPNDisabled;
				ctx.deviceWithDeviceConfigVPNEnabled =
					fx.devices.deviceWithDeviceConfigVPNEnabled;
				ctx.deviceInPreProvisioningState =
					fx.devices.deviceInPreProvisioningState;
				ctx.deviceInPostProvisioningState =
					fx.devices.deviceInPostProvisioningState;

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
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'when the heartbeat is Online',
						'deviceVpnOnHeartbeatOnline',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'when the heartbeat is Timeout',
						'deviceVpnOnHeartbeatTimeout',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'when the heartbeat is Offline',
						'deviceVpnOnHeartbeatOffline',
					);

					itShouldHaveOverallStatus(
						'post-provisioning',
						'when provisioning state is Post-Provisioning',
						'deviceInPostProvisioningState',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'updating',
						'when VPN is disconnected',
						'deviceUpdatingVPNOnly',
					);
				});

				describe('Given a device disconnected from the vpn', () => {
					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'when the heartbeat is Online',
						'deviceVpnOffHeartbeatOnline',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'when the heartbeat is Timeout',
						'deviceVpnOffHeartbeatTimeout',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'when the heartbeat is Timeout and and RESIN_SUPERVISOR_VPN_CONTROL is false',
						'deviceVpnOffHeartbeatTimeoutVPNDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is false',
						'deviceWithDeviceConfigVPNDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is true',
						'deviceWithDeviceConfigVPNEnabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is false in application config variables',
						'deviceWithApplicationConfigVPNDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'disconnected' : 'offline',
						'when the heartbeat is Offline',
						'deviceVpnOffHeartbeatOffline',
					);

					itShouldHaveOverallStatus(
						'configuring',
						'when heartbeat is unknown and last connectivity event does not exist',
						'deviceInPreProvisioningState',
					);

					itShouldHaveOverallStatus(
						'updating',
						'when heartbeat is online',
						'deviceUpdatingHeartbeatOnly',
					);
				});

				describe('Given a device downloading a multicontainer release', () => {
					itShouldHaveOverallStatus(
						'updating',
						'when downloading',
						'deviceUpdating',
					);

					itShouldHaveOverallProgress(
						75,
						'should properly calculate the overall_progress',
						'deviceUpdating',
					);

					itShouldHaveOverallProgress(
						50,
						'should give last calculated overall_progress when connected to VPN and heartbeat offline',
						'deviceUpdatingVPNOnly',
					);

					itShouldHaveOverallProgress(
						25,
						'should properly calculate the overall_progress when VPN is disconnected and heartbeat is online',
						'deviceUpdatingHeartbeatOnly',
					);
				});
			});
		});
	});
};
