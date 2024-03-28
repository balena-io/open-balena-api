import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';
import { expect } from 'chai';

import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import type { Application, Device } from '../src/balena-model.js';
import { expectResourceToMatch } from './test-lib/api-helpers.js';

export default () => {
	versions.test((version, pineTest) => {
		describe('target hostapps', () => {
			let fx: fixtures.Fixtures;
			let admin: UserObjectParam;
			let pineUser: typeof pineTest;
			let applicationId: number;
			let nucHostApp: Application;
			let nucEsrHostApp: Application;
			let device1: fakeDevice.Device;
			let device2: fakeDevice.Device;
			let noMatchDevice: fakeDevice.Device;
			/* eslint-disable @typescript-eslint/naming-convention */
			let nuc2_50_0_rev1prodId: number;
			let nuc2_51_0_rev1prodTagAndSemverId: number;
			let nuc2_51_0_rev2prodSemverOnlyId: number;
			let nucDraft2_90_0TagOnlyId: number;
			let nucDraft2_90_1SemverOnlyId: number;
			let nucDraft2_90_1rev1SemverOnlyId: number;
			/* eslint-enable @typescript-eslint/naming-convention */
			let rpi3hostAppReleaseId: number;
			let failedIntelNucHostAppReleaseId: number;
			let esrTagOnlyHostAppReleaseId: number;
			let esrUnifiedHostAppReleaseId: number;
			let esrSemverOnlyHostAppReleaseId: number;
			let invalidatedTagOnlyReleaseId: number;
			let invalidatedSemverOnlyReleaseId: number;
			let unifiedHostAppReleaseId: number;
			let unifiedSemverOnlyHostAppReleaseId: number;
			let unifiedSemverRevHostAppReleaseId: number;

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
				nucEsrHostApp = fx.applications['intel-nuc-esr'];
				device1 = await fakeDevice.provisionDevice(admin, applicationId);
				device2 = await fakeDevice.provisionDevice(admin, applicationId);
				noMatchDevice = await fakeDevice.provisionDevice(admin, applicationId);
				nuc2_50_0_rev1prodId = fx.releases.release2_50_0_rev1.id;
				nuc2_51_0_rev1prodTagAndSemverId = fx.releases.release2_51_0_rev1.id;
				nuc2_51_0_rev2prodSemverOnlyId = fx.releases.release2_51_0_rev2.id;
				rpi3hostAppReleaseId = fx.releases.rpi3release.id;
				failedIntelNucHostAppReleaseId = fx.releases.releaseIntelNucFailed.id;
				esrTagOnlyHostAppReleaseId = fx.releases.releaseNucEsrTagOnly.id;
				esrUnifiedHostAppReleaseId = fx.releases.releaseNucEsrUnified.id;
				esrSemverOnlyHostAppReleaseId = fx.releases.releaseNucEsrSemverOnly.id;
				invalidatedTagOnlyReleaseId =
					fx.releases.releaseNucInvalidated2_52_0_rev1TagOnly.id;
				invalidatedSemverOnlyReleaseId =
					fx.releases.releaseNucInvalidated2_52_1rev1SemverOnly.id;
				unifiedHostAppReleaseId = fx.releases.unified2_88_4Release.id;
				unifiedSemverOnlyHostAppReleaseId =
					fx.releases.unified2_88_5SemverOnlyRelease.id;
				unifiedSemverRevHostAppReleaseId =
					fx.releases.unified2_88_5_rev1SemverOnlyRelease.id;
				nucDraft2_90_0TagOnlyId = fx.releases.nucDraft2_90_0TagOnly.id;
				nucDraft2_90_1SemverOnlyId = fx.releases.nucDraft2_90_1SemverOnly.id;
				nucDraft2_90_1rev1SemverOnlyId =
					fx.releases.nucDraft2_90_1rev1SemverOnly.id;
			});

			after(async () => {
				await fixtures.clean(fx);
			});

			const versionsToTest = [
				[
					'prod release_tag only',
					{
						os_version: 'balenaOS 2.50.0+rev1',
						os_variant: 'prod',
					},
					() => nuc2_50_0_rev1prodId,
				],
				[
					'prod release_tag & semver',
					{
						os_version: 'balenaOS 2.51.0+rev1',
						os_variant: 'prod',
					},
					() => nuc2_51_0_rev1prodTagAndSemverId,
				],
				[
					'prod semver only',
					{
						os_version: 'balenaOS 2.51.0+rev2',
						os_variant: 'prod',
					},
					() => nuc2_51_0_rev2prodSemverOnlyId,
				],
				[
					'unified release_tag & semver',
					{
						os_version: 'balenaOS 2.88.4',
						os_variant: 'prod',
					},
					() => unifiedHostAppReleaseId,
				],
				[
					'unified semver only',
					{
						os_version: 'balenaOS 2.88.5',
						os_variant: 'prod',
					},
					() => unifiedSemverOnlyHostAppReleaseId,
				],
				[
					'unified semver only with revision',
					{
						os_version: 'balenaOS 2.88.5+rev1',
						os_variant: 'prod',
					},
					() => unifiedSemverRevHostAppReleaseId,
				],
				[
					'ESR release_tag only',
					{
						os_version: 'balenaOS 2021.01.0',
						os_variant: 'prod',
					},
					() => esrTagOnlyHostAppReleaseId,
				],
				[
					'unified ESR',
					{
						os_version: 'balenaOS 2023.1.0',
						os_variant: 'prod',
					},
					() => esrUnifiedHostAppReleaseId,
				],
				[
					'ESR semver only',
					{
						os_version: 'balenaOS 2023.10.0',
						os_variant: 'prod',
					},
					() => esrSemverOnlyHostAppReleaseId,
				],
				[
					'draft release_tag only',
					{
						os_version: 'balenaOS 2.90.0',
						os_variant: 'prod',
					},
					() => nucDraft2_90_0TagOnlyId,
				],
				[
					'draft semver only',
					{
						os_version: 'balenaOS 2.90.1',
						os_variant: 'prod',
					},
					() => nucDraft2_90_1SemverOnlyId,
				],
				[
					'draft semver only',
					{
						os_version: 'balenaOS 2.90.1+rev1',
						os_variant: 'prod',
					},
					() => nucDraft2_90_1rev1SemverOnlyId,
				],
			] as const;

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
							const uuid = fakeDevice.generateDeviceUuid();
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
					[
						'device POST & state PATCH',
						async ({
							belongs_to__application,
							device_type,
							...restDevicePostBody
						}: AnyObject) => {
							const testDevice = await fakeDevice.provisionDevice(
								admin,
								applicationId,
							);
							await testDevice.patchStateV2({
								local: restDevicePostBody,
							});
							return await pineUser
								.get({
									resource: 'device',
									id: testDevice.id,
									options: {
										$select: 'id',
									},
								})
								.expect(200);
						},
					],
				] as const
			).forEach(([titlePart, provisionFn]) => {
				it(`should provision WITHOUT a linked hostapp when not providing a version (using ${titlePart})`, async () => {
					const res = await provisionFn({
						belongs_to__application: applicationId,
						device_type: 'raspberrypi3',
					});
					await expectResourceToMatch(pineUser, 'device', res.body.id, {
						should_be_operated_by__release: null,
					});
				});

				it(`should provision WITHOUT a linked hostapp when the version is not found (using ${titlePart})`, async () => {
					const res = await provisionFn({
						belongs_to__application: applicationId,
						device_type: 'raspberrypi3',
						os_version: 'balenaOS 2.99.0+rev1',
						os_variant: 'prod',
					});
					await expectResourceToMatch(pineUser, 'device', res.body.id, {
						should_be_operated_by__release: null,
					});
				});

				versionsToTest.forEach(
					([osTypeTitlePart, osVersionVariantParams, getHostAppReleaseId]) => {
						const isEsr =
							osVersionVariantParams.os_version.startsWith('balenaOS 20');

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
								await expectResourceToMatch(
									pineUser,
									'device',
									registeredDevice.id,
									{
										should_be_operated_by__release: {
											__id: getHostAppReleaseId(),
										},
									},
								);
							});

							it(`should create a service install for the linked hostapp`, async () => {
								const targetHostApp = isEsr ? nucEsrHostApp : nucHostApp;
								const targetService =
									fx.services[
										isEsr ? 'intel-nuc-esr_service1' : 'intel-nuc_service1'
									];
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
																application: targetHostApp.id,
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
								expect(service).to.have.property('id', targetService.id);
								expect(service).to.have.property('service_name', 'main');
							});
						});
					},
				);
			});

			it('should fail to PATCH intel-nuc device to raspberrypi3 hostapp', async () => {
				// given a device w/ a linked hostApp
				await device1.patchStateV2({
					local: {
						os_version: 'balenaOS 2.50.0+rev1',
						os_variant: 'prod',
					},
				});
				await expectResourceToMatch(pineUser, 'device', device1.id, {
					should_be_operated_by__release: { __id: nuc2_50_0_rev1prodId },
				});

				await supertest(admin)
					.patch(`/${version}/device(${device1.id})`)
					.send({ should_be_operated_by__release: rpi3hostAppReleaseId })
					.expect(
						400,
						'"It is necessary that each release that should operate a device that is of a device type, belongs to an application that is host and is for the device type."',
					);
			});

			it('should fail to PATCH intel-nuc device to a failed hostapp release', async () => {
				await supertest(admin)
					.patch(`/${version}/device(${device1.id})`)
					.send({
						should_be_operated_by__release: failedIntelNucHostAppReleaseId,
					})
					.expect(
						400,
						// TODO: This should ideally be: '"It is necessary that each release that should operate a device, has a status that is equal to \\"success\\"."'
						`"Could not find a hostapp release with this ID ${failedIntelNucHostAppReleaseId}"`,
					);
			});

			(
				[
					[
						'semver & release_tag',
						'balenaOS 2.51.0+rev1',
						() => nuc2_51_0_rev1prodTagAndSemverId,
					],
					[
						'semver only',
						'balenaOS 2.51.0+rev2',
						() => nuc2_51_0_rev2prodSemverOnlyId,
					],
				] as const
			).forEach(([titlePart, osVersion, getUpgradeReleaseId]) => {
				it(`should succeed in PATCHing device to a greater version (with ${titlePart})`, async () => {
					await supertest(admin)
						.patch(`/${version}/device(${device1.id})`)
						.send({ should_be_operated_by__release: getUpgradeReleaseId() })
						.expect(200);
					await expectResourceToMatch(pineUser, 'device', device1.id, {
						should_be_operated_by__release: { __id: getUpgradeReleaseId() },
					});
				});

				it(`should fail to downgrade (when on a release with ${titlePart})`, async () => {
					await supertest(admin)
						.patch(`/${version}/device(${device1.id})`)
						.send({ should_be_operated_by__release: nuc2_50_0_rev1prodId })
						.expect(
							400,
							'"Attempt to downgrade hostapp, which is not allowed"',
						);
				});

				it(`should move the device from older preprovisioned OS release, to the upgraded release reported in state patch (using ${titlePart})`, async () => {
					// if a device is preprovisioned and pinned to a release with a semver
					// less than the version it initially checks in with, we need to clear
					// the old hostApp release, otherwise the model would imply a scheduled OS downgrade.
					const preprovisionedDevice = await fakeDevice.provisionDevice(
						admin,
						applicationId,
					);
					await supertest(admin)
						.patch(`/${version}/device(${preprovisionedDevice.id})`)
						.send({ should_be_operated_by__release: nuc2_50_0_rev1prodId })
						.expect(200);

					// run the actual test
					const devicePatchBody = {
						// this version is greater than the one provided by prodNucHostappReleaseId
						local: {
							os_version: osVersion,
							os_variant: 'prod',
						},
					};
					await preprovisionedDevice.patchStateV2(devicePatchBody);
					await expectResourceToMatch(
						pineUser,
						'device',
						preprovisionedDevice.id,
						{
							should_be_operated_by__release: { __id: getUpgradeReleaseId() },
						},
					);
				});
			});

			it('should succeed in PATCHing device to ESR release', async () => {
				await supertest(admin)
					.patch(`/${version}/device(${device1.id})`)
					.send({ should_be_operated_by__release: esrTagOnlyHostAppReleaseId })
					.expect(200);
				await expectResourceToMatch(pineUser, 'device', device1.id, {
					should_be_operated_by__release: { __id: esrTagOnlyHostAppReleaseId },
				});
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

			(
				[
					[
						'release_tag only',
						'balenaOS 2.52.0+rev1',
						() => invalidatedTagOnlyReleaseId,
					],
					[
						'semver only',
						'balenaOS 2.52.1+rev1',
						() => invalidatedSemverOnlyReleaseId,
					],
				] as const
			).forEach(([osTypeTitlePart, initialOsVersion, getHostAppReleaseId]) => {
				it(`should provision with an invalidated ${osTypeTitlePart} hostapp release`, async () => {
					const invalidatedReleaseDevice = await fakeDevice.provisionDevice(
						admin,
						applicationId,
					);
					const initialInvalidatedReleaseId = getHostAppReleaseId();
					await invalidatedReleaseDevice.patchStateV2({
						local: {
							os_version: initialOsVersion,
							os_variant: 'prod',
						},
					});
					await expectResourceToMatch(
						pineUser,
						'device',
						invalidatedReleaseDevice.id,
						{
							os_version: initialOsVersion,
							os_variant: 'prod',
							should_be_operated_by__release: {
								__id: initialInvalidatedReleaseId,
							},
						},
					);

					const supervisorVersion = 'v12.3.5';
					const newOsVersion = 'balenaOS 2.88.5+rev1';
					await invalidatedReleaseDevice.patchStateV2({
						local: {
							supervisor_version: supervisorVersion,
							os_version: newOsVersion,
							os_variant: 'prod',
						},
					});
					// after provisioning to our invalidated release, let's make sure we're not blocked
					// in further PATCHing (ie there is no rule/hook blocking the device from working)
					await expectResourceToMatch(
						pineUser,
						'device',
						invalidatedReleaseDevice.id,
						{
							supervisor_version: supervisorVersion,
							os_version: newOsVersion,
							os_variant: 'prod',
							// Atm the should_be_operated_by__release is only updated when the device provisions.
							// We might change this during the scheduled or tri-app HUP.
							should_be_operated_by__release: {
								__id: initialInvalidatedReleaseId,
							},
						},
					);
				});
			});

			it('should be able to invalidate a release with devices attached', async () => {
				await device2.patchStateV2({
					local: {
						os_version: 'balenaOS 2.50.0+rev1',
						os_variant: 'prod',
					},
				});
				await expectResourceToMatch(pineUser, 'device', device2.id, {
					should_be_operated_by__release: { __id: nuc2_50_0_rev1prodId },
				});

				await supertest(admin)
					.patch(`/${version}/release(${nuc2_50_0_rev1prodId})`)
					.send({ is_invalidated: true })
					.expect(200);
				const { body } = await supertest(admin)
					.get(`/${version}/release(${nuc2_50_0_rev1prodId})`)
					.expect(200);
				expect(body.d[0].is_invalidated).to.be.true;
			});

			it('should not be able to upgrade to an invalidated release', async () => {
				await supertest(admin)
					.patch(`/${version}/device(${device2.id})`)
					.send({
						should_be_operated_by__release: invalidatedSemverOnlyReleaseId,
					})
					.expect(
						400,
						`"Could not find a hostapp release with this ID ${invalidatedSemverOnlyReleaseId}"`,
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
					.patch(`/${version}/device(${device2.id})`)
					.send({ is_of__device_type: body.d[0]['id'] })
					.expect(200);
				const { body: dev } = await supertest(admin)
					.get(
						`/${version}/device(${device2.id})?$select=should_be_operated_by__release`,
					)
					.expect(200);
				expect(dev.d[0].should_be_operated_by__release).to.be.null;
			});
		});
	});
};
