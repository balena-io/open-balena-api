import { expect } from 'chai';
import type { PineTest } from 'pinejs-client-supertest';
import * as fixtures from './test-lib/fixtures.js';
import { type UserObjectParam, supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import { expectResourceToMatch } from './test-lib/api-helpers.js';

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
				ctx.deviceVpnOffHeartbeatTimeoutResinVpnDisabled =
					fx.devices.deviceVpnOffHeartbeatTimeoutResinVpnDisabled;
				ctx.deviceWithDeviceConfigResinVpnDisabled =
					fx.devices.deviceWithDeviceConfigResinVpnDisabled;
				ctx.deviceWithDeviceConfigBalenaVpnDisabled =
					fx.devices.deviceWithDeviceConfigBalenaVpnDisabled;
				ctx.deviceWithDeviceConfigBalenaVpnDisabledResinVpnEnabled =
					fx.devices.deviceWithDeviceConfigBalenaVpnDisabledResinVpnEnabled;
				ctx.deviceWithApplicationConfigResinVpnDisabled =
					fx.devices.deviceWithApplicationConfigResinVpnDisabled;
				ctx.deviceWithDeviceConfigResinVpnEnabled =
					fx.devices.deviceWithDeviceConfigResinVpnEnabled;
				ctx.deviceWithDeviceConfigBalenaVpnEnabled =
					fx.devices.deviceWithDeviceConfigBalenaVpnEnabled;
				ctx.deviceWithDeviceConfigBalenaVpnEnabledResinVpnDisabled =
					fx.devices.deviceWithDeviceConfigBalenaVpnEnabledResinVpnDisabled;
				ctx.deviceInPreProvisioningState =
					fx.devices.deviceInPreProvisioningState;
				ctx.deviceInPostProvisioningState =
					fx.devices.deviceInPostProvisioningState;

				ctx.appWoRelease = fx.applications.appWoRelease;
				ctx.deviceInAppWoReleases = fx.devices.deviceInAppWoReleases;

				ctx.app3 = fx.applications.app3;
				ctx.release1app3 = fx.releases.release1app3;
				ctx.release2app3 = fx.releases.release2app3;
				ctx.deviceTrackingLatest = fx.devices.deviceTrackingLatest;
				ctx.devicePinned = fx.devices.devicePinned;

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
						'deviceVpnOffHeartbeatTimeoutResinVpnDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is false',
						'deviceWithDeviceConfigResinVpnDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and BALENA_SUPERVISOR_VPN_CONTROL is false',
						'deviceWithDeviceConfigBalenaVpnDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and BALENA_SUPERVISOR_VPN_CONTROL is false and RESIN_SUPERVISOR_VPN_CONTROL is true',
						'deviceWithDeviceConfigBalenaVpnDisabledResinVpnEnabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is true',
						'deviceWithDeviceConfigResinVpnEnabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and BALENA_SUPERVISOR_VPN_CONTROL is true',
						'deviceWithDeviceConfigBalenaVpnEnabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'reduced-functionality' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and BALENA_SUPERVISOR_VPN_CONTROL is true and RESIN_SUPERVISOR_VPN_CONTROL is false',
						'deviceWithDeviceConfigBalenaVpnEnabledResinVpnDisabled',
					);

					itShouldHaveOverallStatus(
						versions.gt(version, 'v6') ? 'operational' : 'idle',
						'should have an ${OVERALL_STATUS} overall_status when the heartbeat is Online and RESIN_SUPERVISOR_VPN_CONTROL is false in application config variables',
						'deviceWithApplicationConfigResinVpnDisabled',
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

			if (versions.lte(version, 'v6')) {
				return;
			}
			describe('device.should_be_running__release (effective target release)', () => {
				describe('Given a device on an application without releases', () => {
					it('should return a null should_be_running__release when selecting it', async function () {
						await expectResourceToMatch(
							pineUser,
							'device',
							ctx.deviceInAppWoReleases.id,
							{
								should_be_running__release: null,
							},
						);
					});

					it('should return an empty array should_be_running__release when expanding it', async function () {
						await expectResourceToMatch(
							pineUser,
							'device',
							ctx.deviceInAppWoReleases.id,
							{},
							{
								should_be_running__release: [],
							},
						);
					});
				});
				describe('Given an application with releases', () => {
					before(async function () {
						// make sure release2app3 is the latest release that the application is tracking
						await expectResourceToMatch(pineUser, 'application', ctx.app3.id, {
							should_be_running__release: { __id: ctx.release2app3.id },
						});
					});
					describe('given a device that tracks latest', () => {
						it('should return a the target release of the application on should_be_running__release when selecting it', async function () {
							await expectResourceToMatch(
								pineUser,
								'device',
								ctx.deviceTrackingLatest.id,
								{
									is_pinned_on__release: null,
									should_be_running__release: { __id: ctx.release2app3.id },
								},
							);
						});
						it('should return a the target release of the application on should_be_running__release when expanding it', async function () {
							await expectResourceToMatch(
								pineUser,
								'device',
								ctx.deviceTrackingLatest.id,
								{},
								{
									is_pinned_on__release: [],
									should_be_running__release: [{ id: ctx.release2app3.id }],
								},
							);
						});
						it('should be able to expand from the release to devices that should be running the release', async function () {
							await expectResourceToMatch(
								pineUser,
								'release',
								ctx.release2app3.id,
								{},
								{
									should_be_running_on__device: [
										{ id: ctx.deviceTrackingLatest.id },
									],
								},
							);
						});
					});
					describe('given a device that is pinned on a release differnet than the one the application tracks', () => {
						it('should return a the target release of the application on should_be_running__release when selecting it', async function () {
							await expectResourceToMatch(
								pineUser,
								'device',
								ctx.devicePinned.id,
								{
									is_pinned_on__release: { __id: ctx.release1app3.id },
									should_be_running__release: { __id: ctx.release1app3.id },
								},
							);
						});
						it('should return a the target release of the application on should_be_running__release when expanding it', async function () {
							await expectResourceToMatch(
								pineUser,
								'device',
								ctx.devicePinned.id,
								{},
								{
									is_pinned_on__release: [{ id: ctx.release1app3.id }],
									should_be_running__release: [{ id: ctx.release1app3.id }],
								},
							);
						});
						it('should be able to expand from the release to devices that should be running the release', async function () {
							await expectResourceToMatch(
								pineUser,
								'release',
								ctx.release1app3.id,
								{},
								{
									should_be_running_on__device: [{ id: ctx.devicePinned.id }],
								},
							);
						});
					});
				});
			});
		});
	});
};
