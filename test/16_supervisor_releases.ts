import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import { assertExists } from './test-lib/common.js';

export default () => {
	versions.test((version, pineTest) => {
		if (!versions.gt(version, 'v6')) {
			// Should be managed by supervisor release was added after v6
			return;
		}
		describe('Devices running supervisor releases', () => {
			const ctx: AnyObject = {};
			let pineUser: typeof pineTest;
			let pineDevice: typeof pineTest;
			let device: fakeDevice.Device;
			let device2: fakeDevice.Device;
			let device3: fakeDevice.Device;
			let device4: fakeDevice.Device;

			before(async () => {
				const fx = await fixtures.load('16-supervisor-app');
				ctx.fixtures = fx;
				ctx.admin = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: {
						user: ctx.admin,
					},
				});
				ctx.deviceApp = fx.applications.app1;
				ctx.amd64SupervisorApp = fx.applications.amd64_supervisor_app;
				ctx.supervisorReleases = ctx.fixtures['releases'];
				device = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
				device2 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
				device3 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
				device4 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
				device4 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
				pineDevice = pineTest.clone({
					passthrough: {
						user: device.token,
					},
				});
			});

			after(async () => {
				await fixtures.clean({ devices: [device, device2, device3, device4] });
				await fixtures.clean(ctx.fixtures);
			});

			describe('Devices running supervisor releases', () => {
				it(`should not have a supervisor service install before the supervisor version gets reported`, async () => {
					const { body: serviceInstalls } = await pineUser
						.get({
							resource: 'service_install',
							options: {
								$filter: {
									device: device.id,
									installs__service: {
										$any: {
											$alias: 'is',
											$expr: {
												is: {
													application: { $ne: ctx.deviceApp.id },
												},
											},
										},
									},
								},
							},
						})
						.expect(200);
					expect(serviceInstalls).to.have.lengthOf(0);
				});

				(
					[
						[
							'device PATCH',
							() => device,
							() =>
								supertest(ctx.admin)
									.patch(`/${version}/device(${device.id})`)
									.send({
										os_version: '2.38.0+rev1',
										supervisor_version: '5.0.1',
									})
									.expect(200),
						],
						[
							'state endpoint PATCH',
							() => device2,
							() =>
								device2.patchStateV2({
									local: {
										api_port: 48484,
										api_secret: 'somesecret',
										os_version: '2.38.0+rev1',
										os_variant: 'dev',
										supervisor_version: '5.0.1',
										provisioning_progress: null,
										provisioning_state: '',
										status: 'Idle',
										// @ts-expect-error the supervisor can send these but we don't expect them so they should be ignored
										logs_channel: null,
										update_failed: false,
										update_pending: false,
										update_downloaded: false,
									},
								}),
						],
					] as const
				).forEach(([titlePart, getDevice, updateDevice]) => {
					it(`should set the device to a non-null supervisor release after ${titlePart}`, async () => {
						await updateDevice();

						const { body: deviceInfo } = await pineUser
							.get({
								resource: 'device',
								id: getDevice().id,
								options: {
									$select: [
										'supervisor_version',
										'should_be_managed_by__release',
									],
								},
							})
							.expect(200);
						assertExists(deviceInfo);
						const { body: nativeSupervisorRelease } = await pineUser
							.get({
								resource: 'release',
								id: deviceInfo.should_be_managed_by__release.__id,
								options: {
									$select: ['id', 'release_version'],
								},
							})
							.expect(200);
						expect(nativeSupervisorRelease).to.have.property(
							'release_version',
							`v${deviceInfo.supervisor_version}`,
						);
						expect(nativeSupervisorRelease).to.have.property(
							'id',
							ctx.supervisorReleases['5.0.1'].id,
						);
					});

					it.skip(`should create a service install for the supervisor release after ${titlePart}`, async () => {
						const { body: serviceInstalls } = await pineUser
							.get({
								resource: 'service_install',
								options: {
									$expand: {
										installs__service: {
											$select: ['id', 'service_name'],
										},
									},
									$filter: {
										device: getDevice().id,
										installs__service: {
											$any: {
												$alias: 'is',
												$expr: {
													is: {
														application: ctx.amd64SupervisorApp.id,
													},
												},
											},
										},
									},
								},
							} as const)
							.expect(200);
						expect(serviceInstalls).to.have.lengthOf(1);
						const [service] = serviceInstalls[0].installs__service;
						expect(service).to.have.property(
							'id',
							ctx.fixtures.services.amd64_supervisor_app_service1.id,
						);
						expect(service).to.have.property('service_name', 'main');
					});
				});

				it('should allow upgrading to a logstream version', async () => {
					const patch = {
						should_be_managed_by__release:
							ctx.supervisorReleases['6.0.1_logstream'].id,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch)
						.expect(200);
					const res = await supertest(ctx.admin).get(
						`/${version}/device(${device.id})`,
					);
					expect(res.body)
						.to.have.nested.property('d[0].should_be_managed_by__release.__id')
						.that.equals(ctx.supervisorReleases['6.0.1_logstream'].id);
				});

				it('should provision to a _logstream supervisor edition', async () => {
					await device4.patchStateV2({
						local: {
							api_port: 48484,
							api_secret: 'somesecret',
							os_version: '2.38.0+rev1',
							os_variant: 'dev',
							supervisor_version: '6.0.1',
							provisioning_progress: null,
							provisioning_state: '',
							status: 'Idle',
							// @ts-expect-error the supervisor can send these but we don't expect them so they should be ignored
							logs_channel: null,
							update_failed: false,
							update_pending: false,
							update_downloaded: false,
						},
					});

					const res = await supertest(ctx.admin).get(
						`/${version}/device(${device4.id})`,
					);
					expect(res.body)
						.to.have.nested.property('d[0].should_be_managed_by__release.__id')
						.that.equals(ctx.supervisorReleases['6.0.1_logstream'].id);
				});

				it("should allow upgrading a device's supervisor release", async () => {
					const patch = {
						should_be_managed_by__release: ctx.supervisorReleases['7.0.1'].id,
					};
					const patch2 = {
						should_be_managed_by__release: ctx.supervisorReleases['8.0.1'].id,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch)
						.expect(200);
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch2)
						.expect(200);
					const res = await supertest(ctx.admin).get(
						`/${version}/device(${device.id})`,
					);
					expect(res.body)
						.to.have.nested.property('d[0].should_be_managed_by__release.__id')
						.that.equals(ctx.supervisorReleases['8.0.1'].id);
				});

				it('should provision to an invalidated release', async () => {
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							supervisor_version: null,
							should_be_managed_by__release: null,
						})
						.expect(200);
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							supervisor_version: '8.0.1',
						})
						.expect(200);
					const { body } = await supertest(ctx.admin)
						.get(`/${version}/device(${device.id})`)
						.expect(200);
					expect(body).to.have.nested.property(
						'd[0].should_be_managed_by__release',
					).that.is.not.null;
				});

				it('should not allow upgrading to a release with a 0.0.0 semver', async () => {
					const supervisorReleaseId =
						ctx.supervisorReleases['only_release_version'].id;
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							should_be_managed_by__release: supervisorReleaseId,
						})
						.expect(
							400,
							'"Attempt to downgrade supervisor, which is not allowed"',
						);
				});

				it('should not allow upgrading to a release without any version', async () => {
					const supervisorReleaseId = ctx.supervisorReleases['no_version'].id;
					const { body } = await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							should_be_managed_by__release: supervisorReleaseId,
						})
						.expect(400);
					expect(body).to.be.oneOf([
						'Attempt to downgrade supervisor, which is not allowed',
						// TODO: Drop this in a follow-up PR after this gets deployed
						`Supervisor release with ID ${supervisorReleaseId} does not exist or has no release version`,
					]);
				});

				it('should not allow upgrading to a different architecture', async () => {
					const patch = {
						should_be_managed_by__release:
							ctx.supervisorReleases['12.1.1_armv7hf'].id,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch)
						.expect(400);
				});

				it('should not allow upgrading to an invalidated release', async () => {
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device3.id})`)
						.send({
							supervisor_version: '8.0.1',
						})
						.expect(200);
					const patch = {
						should_be_managed_by__release: ctx.supervisorReleases['8.1.1'].id,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device3.id})`)
						.send(patch)
						.expect(400);
				});

				it('should not allow setting a supervisor native release to a non-public app', async () => {
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							should_be_managed_by__release:
								ctx.supervisorReleases['user_release'].id,
						})
						.expect(400);
				});

				it('should not allow setting a supervisor native release to a hostapp', async () => {
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							should_be_managed_by__release:
								ctx.supervisorReleases['hostapp_release'].id,
						})
						.expect(400);
				});

				it('should fail if supervisor release does not exist', async () => {
					const fakeId = 999;
					const patch = {
						should_be_managed_by__release: fakeId,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch)
						.expect(400);
				});

				it('should not allow downgrading a supervisor version', async () => {
					const patch = {
						should_be_managed_by__release: ctx.supervisorReleases['7.0.1'].id,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch)
						.expect(400);
				});

				it('should correctly determine logstream values', async () => {
					const patch = {
						should_be_managed_by__release:
							ctx.supervisorReleases['6.0.1_logstream'].id,
					};
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send(patch)
						.expect(400);
				});

				it('should allow upgrading to a release with both a semver & a release version', async () => {
					expect(ctx.supervisorReleases['8.1.2']).to.have.property(
						'release_version',
						'v8.1.2',
					);
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							should_be_managed_by__release: ctx.supervisorReleases['8.1.2'].id,
						})
						.expect(200);
				});

				it('should allow upgrading to a release with a semver & no release version', async () => {
					expect(ctx.supervisorReleases['12.1.1_amd64']).to.have.property(
						'release_version',
						null,
					);
					await supertest(ctx.admin)
						.patch(`/${version}/device(${device.id})`)
						.send({
							should_be_managed_by__release:
								ctx.supervisorReleases['12.1.1_amd64'].id,
						})
						.expect(200);
				});

				describe('new supervisor service name', function () {
					// Documenting that we didn't implement this, since updating the should_be_managed_by__release field is the supported way
					it.skip(`should not create an extra supervisor service install when patching a new supervisor version`, async () => {
						await device3.patchStateV2({
							local: {
								api_port: 48484,
								api_secret: 'somesecret',
								os_version: '2.85.14+rev1',
								os_variant: 'dev',
								supervisor_version: '12.11.0',
								provisioning_progress: null,
								provisioning_state: '',
								status: 'Idle',
								// @ts-expect-error the supervisor can send these but we don't expect them so they should be ignored						update_failed: false,
								logs_channel: null,
								update_pending: false,
								update_downloaded: false,
							},
						});

						const { body: serviceInstalls } = await pineUser
							.get({
								resource: 'service_install',
								options: {
									$expand: {
										installs__service: {
											$select: ['id', 'service_name'],
										},
									},
									$filter: {
										device: device3.id,
										installs__service: {
											$any: {
												$alias: 'is',
												$expr: {
													is: {
														application: ctx.amd64SupervisorApp.id,
													},
												},
											},
										},
									},
								},
							} as const)
							.expect(200);
						expect(serviceInstalls).to.have.lengthOf(1);
						const [service] = serviceInstalls[0].installs__service;
						expect(service).to.have.property(
							'id',
							ctx.fixtures.services.amd64_supervisor_app_service1.id,
						);
						expect(service).to.have.property('service_name', 'main');
					});

					(
						[
							['device', () => pineDevice, () => device],
							['user', () => pineUser, () => device2],
						] as const
					).forEach(([titlePart, getPineTestInstance, getDevice]) => {
						it.skip(`should create an extra supervisor service install after updating the target supervisor release using a ${titlePart} api key`, async () => {
							// Similarly to how the HUP script does it
							// See: https://github.com/balena-os/balenahup/blob/d38eba01aebf4c4eb8425cb50a4dc9b948decc46/upgrade-2.x.sh#L229
							await getPineTestInstance()
								.patch({
									resource: 'device',
									id: { uuid: getDevice().uuid },
									body: {
										should_be_managed_by__release:
											ctx.fixtures.releases['12.11.0_amd64'].id,
									},
								})
								.expect(200);

							const { body: serviceInstalls } = await pineUser
								.get<AnyObject[]>({
									resource: 'service_install',
									options: {
										$expand: {
											installs__service: {
												$select: ['id', 'service_name'],
											},
										},
										$filter: {
											device: getDevice().id,
											installs__service: {
												$any: {
													$alias: 'is',
													$expr: {
														is: {
															application: ctx.amd64SupervisorApp.id,
														},
													},
												},
											},
										},
										$orderby: { created_at: 'asc' },
									},
								} as const)
								.expect(200);
							expect(serviceInstalls).to.have.lengthOf(2);
							const [oldService, newService] = serviceInstalls.map(
								(si) => si.installs__service[0],
							);
							expect(oldService).to.have.property(
								'id',
								ctx.fixtures.services.amd64_supervisor_app_service1.id,
							);
							expect(oldService).to.have.property('service_name', 'main');
							expect(newService).to.have.property(
								'id',
								ctx.fixtures.services.amd64_supervisor_app_service2.id,
							);
							expect(newService).to.have.property(
								'service_name',
								'balena-supervisor',
							);
						});
					});
				});
			});
		});
	});
};
