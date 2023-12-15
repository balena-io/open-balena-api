import * as fixtures from './test-lib/fixtures';
import * as fakeDevice from './test-lib/fake-device';
import { expect } from 'chai';

import { supertest, UserObjectParam } from './test-lib/supertest';
import * as versions from './test-lib/versions';
import type { Application, Device } from '../src/balena-model';

versions.test((version, pineTest) => {
	describe('target hostapps', () => {
		let fx: fixtures.Fixtures;
		let admin: UserObjectParam;
		let pineUser: typeof pineTest;
		let applicationId: number;
		let nucHostApp: Application;
		let device: fakeDevice.Device;
		let device2: fakeDevice.Device;
		let preprovisionedDevice: fakeDevice.Device;
		let esrDevice: fakeDevice.Device;
		let noMatchDevice: fakeDevice.Device;
		let invalidatedReleaseDevice: fakeDevice.Device;
		let prodNucHostappReleaseId: number;
		let raspberryPiHostappReleaseId: number;
		let failedIntelNucHostAppReleaseId: number;
		let upgradeReleaseId: number;
		let esrHostappReleaseId: number;
		let invalidatedReleaseId: number;
		let unifiedHostAppReleaseId: number;

		before(async () => {
			fx = await fixtures.load('15-target-hostapps');
			admin = fx.users.admin;
			pineUser = pineTest.clone({
				passthrough: {
					user: admin,
				},
			});
			applicationId = fx.applications['user-app1'].id;
			nucHostApp = fx.applications['intel-nuc'];
			device = await fakeDevice.provisionDevice(admin, applicationId);
			device2 = await fakeDevice.provisionDevice(admin, applicationId);
			preprovisionedDevice = await fakeDevice.provisionDevice(
				admin,
				applicationId,
			);
			esrDevice = await fakeDevice.provisionDevice(admin, applicationId);
			noMatchDevice = await fakeDevice.provisionDevice(admin, applicationId);
			invalidatedReleaseDevice = await fakeDevice.provisionDevice(
				admin,
				applicationId,
			);
			prodNucHostappReleaseId = fx.releases.release0.id;
			raspberryPiHostappReleaseId = fx.releases.release1.id;
			failedIntelNucHostAppReleaseId = fx.releases.releaseIntelNucFailed.id;
			upgradeReleaseId = fx.releases.release2.id;
			esrHostappReleaseId = fx.releases.release3.id;
			invalidatedReleaseId = fx.releases.release5.id;
			unifiedHostAppReleaseId = fx.releases.unifiedRelease.id;
		});

		after(async () => {
			await fixtures.clean({
				devices: [
					device,
					device2,
					esrDevice,
					noMatchDevice,
					invalidatedReleaseDevice,
					preprovisionedDevice,
				],
			});
			await fixtures.clean(fx);
		});

		it('should provision with a linked prod hostapp (using PATCH)', async () => {
			const devicePatchBody = {
				local: {
					os_version: 'balenaOS 2.50.0+rev1',
					os_variant: 'prod',
				},
			};

			await device.patchStateV2(devicePatchBody);
			const { body } = await supertest(admin)
				.get(
					`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]).to.have.nested.property(
				'should_be_operated_by__release.__id',
				prodNucHostappReleaseId,
			);
		});

		it('should provision with a linked unified hostapp (using PATCH)', async () => {
			const devicePatchBody = {
				local: {
					os_version: 'balenaOS 2.88.4',
					os_variant: 'prod',
				},
			};

			await device2.patchStateV2(devicePatchBody);
			const { body } = await supertest(admin)
				.get(
					`/${version}/device(${device2.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]).to.have.nested.property(
				'should_be_operated_by__release.__id',
				unifiedHostAppReleaseId,
			);
		});

		(
			[
				[
					'POST device resource',
					async ({ device_type, ...devicePostBody }: AnyObject) => {
						return await supertest(admin)
							.post(`/${version}/device`)
							.send({
								...devicePostBody,
								is_of__device_type: (
									await pineTest
										.get({
											resource: 'device_type',
											passthrough: { user: admin },
											id: { slug: device_type },
											options: {
												$select: 'id',
											},
										})
										.expect(200)
								).body.id,
							})
							.expect(201);
					},
				],
				[
					'POST /device/register',
					async ({
						belongs_to__application,
						...restDevicePostBody
					}: AnyObject) => {
						const { body: provisioningKey } = await supertest(admin)
							.post(`/api-key/application/${applicationId}/provisioning`)
							.expect(200);
						const uuid =
							'f716a3e020bd444b885cb394453917520c3cf82e69654f84be0d33e31a0e15';
						return await supertest()
							.post(`/device/register?apikey=${provisioningKey}`)
							.send({
								user: admin.id,
								application: belongs_to__application,
								uuid,
								...restDevicePostBody,
							})
							.expect(201);
					},
				],
			] as const
		).forEach(([titlePart, provisionFn]) => {
			it(`should provision WITHOUT a linked hostapp when not providing a version (using ${titlePart})`, async () => {
				const res = await provisionFn({
					belongs_to__application: applicationId,
					device_type: 'raspberrypi3',
				});
				const { body } = await supertest(admin)
					.get(
						`/${version}/device(${res.body.id})?$select=should_be_operated_by__release`,
					)
					.expect(200);
				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'should_be_operated_by__release',
					null,
				);
				await fixtures.clean({
					devices: [res.body],
				});
			});

			it(`should provision WITHOUT a linked hostapp when the version is not found (using ${titlePart})`, async () => {
				const res = await provisionFn({
					belongs_to__application: applicationId,
					device_type: 'raspberrypi3',
					os_version: 'balenaOS 2.99.0+rev1',
					os_variant: 'prod',
				});
				const { body } = await supertest(admin)
					.get(
						`/${version}/device(${res.body.id})?$select=should_be_operated_by__release`,
					)
					.expect(200);
				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'should_be_operated_by__release',
					null,
				);
				await fixtures.clean({
					devices: [res.body],
				});
			});

			(
				[
					[
						'prod',
						{
							os_version: 'balenaOS 2.50.0+rev1',
							os_variant: 'prod',
						},
						() => prodNucHostappReleaseId,
					],
					[
						'unified',
						{
							os_version: 'balenaOS 2.88.4',
							os_variant: 'prod',
						},
						() => unifiedHostAppReleaseId,
					],
				] as const
			).forEach(
				([osTypeTitlePart, osVersionVariantParams, getHostAppReleaseId]) => {
					describe(`provisioning with a ${osTypeTitlePart} OS (using ${titlePart})`, function () {
						let registeredDevice: Device;

						after(async function () {
							await fixtures.clean({
								devices: [registeredDevice],
							});
						});

						it(`should provision with a linked hostapp`, async () => {
							({ body: registeredDevice } = await provisionFn({
								belongs_to__application: applicationId,
								device_type: 'intel-nuc',
								...osVersionVariantParams,
							}));
							const {
								body: {
									d: [fetchedDevice],
								},
							} = await supertest(admin)
								.get(
									`/${version}/device(${registeredDevice.id})?$select=should_be_operated_by__release`,
								)
								.expect(200);
							const hostappReleaseId = getHostAppReleaseId();
							expect(fetchedDevice).to.have.nested.property(
								'should_be_operated_by__release.__id',
								hostappReleaseId,
							);
						});

						it(`should create a service install for the linked hostapp`, async () => {
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
											device: registeredDevice.id,
											installs__service: {
												$any: {
													$alias: 'is',
													$expr: {
														is: {
															application: nucHostApp.id,
														},
													},
												},
											},
										},
									},
								})
								.expect(200);
							expect(serviceInstalls).to.have.lengthOf(1);
							const [service] = serviceInstalls[0].installs__service;
							expect(service).to.have.property(
								'id',
								fx.services['intel-nuc_service1'].id,
							);
							expect(service).to.have.property('service_name', 'main');
						});
					});
				},
			);
		});

		it('should provision with a linked ESR hostapp', async () => {
			const devicePatchBody = {
				local: {
					os_version: 'balenaOS 2021.01.0',
					os_variant: 'prod',
				},
			};

			await esrDevice.patchStateV2(devicePatchBody);
			const { body } = await supertest(admin)
				.get(
					`/${version}/device(${esrDevice.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]).to.have.property('should_be_operated_by__release').that
				.is.not.null;
		});

		it('should fail to PATCH intel-nuc device to raspberrypi3 hostapp', async () => {
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({ should_be_operated_by__release: raspberryPiHostappReleaseId })
				.expect(
					400,
					'"It is necessary that each release that should operate a device that is of a device type, belongs to an application that is host and is for the device type."',
				);
		});

		it('should fail to PATCH intel-nuc device to a failed hostapp release', async () => {
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({
					should_be_operated_by__release: failedIntelNucHostAppReleaseId,
				})
				.expect(
					400,
					// TODO: This should ideally be: '"It is necessary that each release that should operate a device, has a status that is equal to \\"success\\"."'
					`"Could not find a hostapp release with this ID ${failedIntelNucHostAppReleaseId}"`,
				);
		});

		it('should succeed in PATCHing device to greater version', async () => {
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({ should_be_operated_by__release: upgradeReleaseId })
				.expect(200);
			const { body } = await supertest(admin).get(
				`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
			);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]['should_be_operated_by__release'].__id).to.equal(
				upgradeReleaseId,
			);
		});

		it('should fail to downgrade', async () => {
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({ should_be_operated_by__release: prodNucHostappReleaseId })
				.expect(400, '"Attempt to downgrade hostapp, which is not allowed"');
		});

		it('should remove target preprovisioned hostapp, if it is an implied downgrade', async () => {
			// if a device is preprovisioned and pinned to a release
			// less than the version it initially checks in with, make sure the downgrade doesn't persist
			const { body } = await supertest(admin)
				.get(
					`/${version}/device(${preprovisionedDevice.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body.d[0]).to.have.property(
				'should_be_operated_by__release',
				null,
			);

			await supertest(admin)
				.patch(`/${version}/device(${preprovisionedDevice.id})`)
				.send({ should_be_operated_by__release: prodNucHostappReleaseId })
				.expect(200);
			const devicePatchBody = {
				local: {
					// this version is greater than the one provided by prodNucHostappReleaseId
					os_version: 'balenaOS 2.50.1+rev1',
					os_variant: 'prod',
				},
			};
			await preprovisionedDevice.patchStateV2(devicePatchBody);
			const body2 = await supertest(admin)
				.get(
					`/${version}/device(${preprovisionedDevice.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body2.body.d[0]['should_be_operated_by__release'].__id).to.equal(
				upgradeReleaseId,
			);
		});

		it('should succeed in PATCHing device to ESR release', async () => {
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({ should_be_operated_by__release: esrHostappReleaseId })
				.expect(200);
			const { body } = await supertest(admin).get(
				`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
			);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]['should_be_operated_by__release'].__id).to.equal(
				esrHostappReleaseId,
			);
		});

		it('should still provision with a nonexistent hostapp', async () => {
			const devicePatchBody = {
				local: {
					os_version: 'balenaOS 2999.01.0',
					os_variant: 'prod',
				},
			};

			await noMatchDevice.patchStateV2(devicePatchBody);
			const { body } = await supertest(admin)
				.get(
					`/${version}/device(${noMatchDevice.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]).to.have.property(
				'should_be_operated_by__release',
				null,
			);
			expect(body.d[0]['os_version']).to.be.not.null;
			expect(body.d[0]['os_variant']).to.be.not.null;
		});

		it('should provision with an invalidated hostapp release', async () => {
			const devicePatchBody = {
				local: {
					os_version: 'balenaOS 2.52.0+rev1',
					os_variant: 'prod',
				},
			};

			await invalidatedReleaseDevice.patchStateV2(devicePatchBody);
			const { body } = await supertest(admin)
				.get(
					`/${version}/device(${invalidatedReleaseDevice.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(body.d[0]).to.not.be.undefined;
			expect(body.d[0]['should_be_operated_by__release'].__id).to.equal(
				invalidatedReleaseId,
			);
			expect(body.d[0]['os_version']).to.be.not.null;
			expect(body.d[0]['os_variant']).to.be.not.null;
			const supervisorVersion = 'v12.3.5';
			const devicePatchBody2 = {
				local: {
					supervisor_version: supervisorVersion,
				},
			};

			await invalidatedReleaseDevice.patchStateV2(devicePatchBody2);
			// after provisioning to our invalidated release, let's make sure we're not blocked
			// in further PATCHing (using supervisor_version here as a proxy/dummy value)
			const resp = await supertest(admin)
				.get(
					`/${version}/device(${invalidatedReleaseDevice.id})?$select=supervisor_version`,
				)
				.expect(200);
			expect(resp.body.d[0]['supervisor_version']).to.equal(supervisorVersion);
		});

		it('should be able to invalidate a release with devices attached', async () => {
			await supertest(admin)
				.patch(`/${version}/release(${prodNucHostappReleaseId})`)
				.send({ is_invalidated: true })
				.expect(200);
			const { body } = await supertest(admin)
				.get(`/${version}/release(${prodNucHostappReleaseId})`)
				.expect(200);
			expect(body.d[0].is_invalidated).to.be.true;
		});

		it('should not be able to upgrade to an invalidated release', async () => {
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({ should_be_operated_by__release: prodNucHostappReleaseId })
				.expect(
					400,
					`"Could not find a hostapp release with this ID ${prodNucHostappReleaseId}"`,
				);
		});

		it("should null target hostapp when a device's device type is changed", async () => {
			const { body } = await supertest(admin)
				.get(
					`/${version}/device_type?$select=id&$filter=slug eq 'raspberrypi3'`,
				)
				.expect(200);
			expect(body.d[0]['id']).to.be.not.null;
			await supertest(admin)
				.patch(`/${version}/device(${device.id})`)
				.send({ is_of__device_type: body.d[0]['id'] })
				.expect(200);
			const { body: dev } = await supertest(admin)
				.get(
					`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
				)
				.expect(200);
			expect(dev.d[0].should_be_operated_by__release).to.be.null;
		});
	});
});
