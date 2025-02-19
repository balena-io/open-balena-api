import { expect } from 'chai';

import * as fakeDevice from './test-lib/fake-device.js';
import * as versions from './test-lib/versions.js';

import * as fixtures from './test-lib/fixtures.js';

import { assertExists, expectToEventually } from './test-lib/common.js';
import * as config from '@balena/open-balena-api/config';
import { supertest } from './test-lib/supertest.js';
import {
	expectNewSettledTasks,
	resetLatestTaskIds,
} from './test-lib/api-helpers.js';

export default () => {
	versions.test((version, pineTest) => {
		const pinnedOnReleaseField = versions.gt(version, 'v6')
			? 'is_pinned_on__release'
			: 'should_be_running__release';

		[true, false].forEach((isServiceInstallEnabled) => {
			describe(`should create service installs ${isServiceInstallEnabled ? 'asynchronously' : 'synchronously'}`, () => {
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
					ctx.app2Service2 = fx.services.app2Service2;
					ctx.intelNucHostAppService1 =
						fx.services['intel-nuc-host-appService1'];

					config.TEST_MOCK_ONLY.ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED =
						isServiceInstallEnabled;

					await resetLatestTaskIds('create_service_installs');
				});

				after(async () => {
					await fixtures.clean(ctx.loadedFixtures);
				});

				it('when a device is created', async () => {
					const device = await fakeDevice.provisionDevice(
						ctx.admin,
						ctx.app1.id,
					);
					ctx.device = device;

					await expectToEventually(async () => {
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
					});
					await expectNewSettledTasks(
						'create_service_installs',
						isServiceInstallEnabled
							? [
									{
										is_executed_with__parameter_set: {
											devices: [ctx.device.id],
										},
										status: 'succeeded',
									},
								]
							: [],
					);
				});

				it('when a device is created with an os release specified', async () => {
					const { body: provisioningKey } = await supertest(ctx.admin)
						.post(`/api-key/application/${ctx.app1.id}/provisioning`)
						.expect(200);
					const uuid = fakeDevice.generateDeviceUuid();
					const { body: deviceWithOsVersion } = await supertest()
						.post(`/device/register?apikey=${provisioningKey}`)
						.send({
							user: ctx.admin.id,
							application: ctx.app1.id,
							device_type: 'intel-nuc',
							uuid,
							os_version: 'balenaOS 2.88.4',
							os_variant: 'prod',
						})
						.expect(201);
					ctx.deviceWithOsVersion = deviceWithOsVersion;

					await expectToEventually(async () => {
						const { body: serviceInstalls } = await pineUser
							.get({
								resource: 'service_install',
								options: {
									$select: ['device', 'installs__service'],
									$filter: {
										device: deviceWithOsVersion.id,
									},
									$orderby: { installs__service: 'asc' },
								},
							})
							.expect(200);
						expect(serviceInstalls).to.deep.equal(
							[ctx.app1Service1.id, ctx.intelNucHostAppService1.id]
								.sort((a, b) => a - b)
								.map((serviceInstallId) => ({
									device: { __id: deviceWithOsVersion.id },
									installs__service: { __id: serviceInstallId },
								})),
						);
					});
					await expectNewSettledTasks(
						'create_service_installs',
						isServiceInstallEnabled
							? [
									{
										is_executed_with__parameter_set: {
											devices: [deviceWithOsVersion.id],
										},
										status: 'succeeded',
									},
								]
							: [],
					);
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

					await expectToEventually(async () => {
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
					await expectNewSettledTasks(
						'create_service_installs',
						isServiceInstallEnabled
							? [
									{
										is_executed_with__parameter_set: {
											devices: [ctx.device.id, ctx.deviceWithOsVersion.id],
										},
										status: 'succeeded',
									},
								]
							: [],
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

					await expectToEventually(async () => {
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
					await expectNewSettledTasks(
						'create_service_installs',
						isServiceInstallEnabled
							? [
									{
										is_executed_with__parameter_set: {
											devices: [ctx.device.id],
										},
										status: 'succeeded',
									},
								]
							: [],
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

					await expectNewSettledTasks(
						'create_service_installs',
						isServiceInstallEnabled
							? [
									{
										is_executed_with__parameter_set: {
											devices: [ctx.device.id],
										},
										status: 'succeeded',
									},
								]
							: [],
					);

					await pineUser
						.patch({
							resource: 'device',
							id: ctx.device.id,
							body: { belongs_to__application: ctx.app2.id },
						})
						.expect(200);

					await expectToEventually(async () => {
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
					await expectNewSettledTasks(
						'create_service_installs',
						isServiceInstallEnabled
							? [
									{
										is_executed_with__parameter_set: {
											devices: [ctx.device.id],
										},
										status: 'succeeded',
									},
								]
							: [],
					);
				});

				it('should be able to use service_install to create a device_service_environment_variable', async () => {
					const { body: serviceInstall } = await pineUser
						.get({
							resource: 'service_install',
							id: {
								device: ctx.device.id,
								installs__service: ctx.app2Service1.id,
							},
						})
						.expect(200);
					assertExists(serviceInstall);

					const { body: deviceServiceEnvVar } = await pineUser
						.post({
							resource: 'device_service_environment_variable',
							body: {
								service_install: serviceInstall.id,
								name: 'test',
								value: '123',
							},
						})
						.expect(201);
					assertExists(deviceServiceEnvVar);

					const {
						body: {
							d: [dbDeviceServiceEnvVar],
						},
					} = await supertest(ctx.admin)
						.get(
							`/resin/device_service_environment_variable(${deviceServiceEnvVar.id})?$select=device,service`,
						)
						.expect(200);

					expect(dbDeviceServiceEnvVar.device.__id).to.equal(ctx.device.id);
					expect(dbDeviceServiceEnvVar.service.__id).to.equal(
						ctx.app2Service1.id,
					);
				});

				it('should be able to update device_service_environment_variable service_install', async () => {
					const { body: serviceInstallService1 } = await pineUser
						.get({
							resource: 'service_install',
							id: {
								device: ctx.device.id,
								installs__service: ctx.app2Service1.id,
							},
						})
						.expect(200);
					assertExists(serviceInstallService1);

					const { body: serviceInstallService2 } = await pineUser
						.get({
							resource: 'service_install',
							id: {
								device: ctx.device.id,
								installs__service: ctx.app2Service2.id,
							},
						})
						.expect(200);
					assertExists(serviceInstallService2);

					const {
						body: [deviceServiceEnvVar],
					} = await pineUser
						.get({
							resource: 'device_service_environment_variable',
							options: {
								$filter: {
									service_install: serviceInstallService1.id,
								},
							},
						})
						.expect(200);
					assertExists(deviceServiceEnvVar);

					await pineUser
						.patch({
							resource: 'device_service_environment_variable',
							id: deviceServiceEnvVar.id,
							body: {
								service_install: serviceInstallService2.id,
							},
						})
						.expect(200);

					const {
						body: {
							d: [dbDeviceServiceEnvVar],
						},
					} = await supertest(ctx.admin)
						.get(
							`/resin/device_service_environment_variable(${deviceServiceEnvVar.id})?$select=device,service`,
						)
						.expect(200);

					expect(dbDeviceServiceEnvVar.device.__id).to.equal(ctx.device.id);
					expect(dbDeviceServiceEnvVar.service.__id).to.equal(
						ctx.app2Service2.id,
					);
				});
			});
		});
	});
};
