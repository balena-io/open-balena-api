import { expect } from 'chai';

import { connectDeviceAndWaitForUpdate } from './test-lib/connect-device-and-wait.js';
import * as fakeDevice from './test-lib/fake-device.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';

import * as fixtures from './test-lib/fixtures.js';
import {
	addReleaseToApp,
	addImageToService,
	addServiceToApp,
	addImageToRelease,
	expectResourceToMatch,
} from './test-lib/api-helpers.js';
import type { Application, DeviceType, Release } from '../src/balena-model.js';
import { assertExists, expectToEventually } from './test-lib/common.js';

export default () => {
	versions.test((version, pineTest) => {
		const pinnedOnReleaseField = versions.gt(version, 'v6')
			? 'is_pinned_on__release'
			: 'should_be_running__release';

		describe(`Tracking latest release`, () => {
			let fx: fixtures.Fixtures;
			let admin: UserObjectParam;
			let pineUser: typeof pineTest;
			let applicationId: number;
			let application2Id: number;
			let application3Id: number;
			let appUuid: string;
			let app2Uuid: string;
			let app3Uuid: string;
			let device: fakeDevice.Device;
			let device2: fakeDevice.Device;
			let device3: fakeDevice.Device;
			let device4: fakeDevice.Device;
			let device5: fakeDevice.Device;
			let applicationToDelete: Application['Read'];

			before(async () => {
				fx = await fixtures.load('14-release-pinning');

				admin = fx.users.admin;

				pineUser = pineTest.clone({
					passthrough: { user: admin },
				});

				applicationId = fx.applications.app1.id;
				application2Id = fx.applications.app2.id;
				application3Id = fx.applications.app3.id;
				appUuid = fx.applications.app1.uuid;
				app2Uuid = fx.applications.app2.uuid;
				app3Uuid = fx.applications.app3.uuid;

				// create a new device in this test application...
				device = await fakeDevice.provisionDevice(admin, applicationId);
				device2 = await fakeDevice.provisionDevice(admin, application2Id);
				device3 = await fakeDevice.provisionDevice(admin, application3Id);
				device4 = await fakeDevice.provisionDevice(admin, application3Id);
			});

			after(async () => {
				await fixtures.clean(fx);
			});

			it('Should track latest release that is passing tests and final', async () => {
				const expectedLatest = fx.releases.release0;
				await expectResourceToMatch(pineUser, 'device', device.id, {
					[pinnedOnReleaseField]: null,
					...(versions.gt(version, 'v6') && {
						should_be_running__release: { __id: expectedLatest.id },
					}),
				});

				const stateV2 = await device.getStateV2();
				expect(
					stateV2.local.apps[applicationId].releaseId,
					'v2 target state should return correct release',
				).to.equal(expectedLatest.id);

				const stateV3 = await device.getStateV3();
				expect(
					stateV3[device.uuid].apps[appUuid].releases,
					'v3 target state should return correct release',
				)
					.to.have.property(expectedLatest.commit)
					.that.has.property('id')
					.that.equals(expectedLatest.id);
			});

			it('Should allow pinning a device to a draft and untested release', async () => {
				const pinnedRelease = fx.releases.release1;
				await supertest(admin)
					.patch(`/${version}/device(${device.id})`)
					.send({
						[pinnedOnReleaseField]: pinnedRelease.id,
					})
					.expect(200);

				await expectResourceToMatch(pineUser, 'device', device.id, {
					[pinnedOnReleaseField]: { __id: pinnedRelease.id },
					...(versions.gt(version, 'v6') && {
						should_be_running__release: { __id: pinnedRelease.id },
					}),
				});

				const stateV2 = await device.getStateV2();
				expect(
					stateV2.local.apps[applicationId].releaseId,
					'v2 target state should return correct release',
				).to.equal(pinnedRelease.id);

				const stateV3 = await device.getStateV3();
				expect(
					stateV3[device.uuid].apps[appUuid].releases,
					'v3 target state should return correct release',
				)
					.to.have.property(pinnedRelease.commit)
					.that.has.property('id')
					.that.equals(pinnedRelease.id);

				const expectedLatest = fx.releases.release0;
				await supertest(admin)
					.patch(`/${version}/device(${device.id})`)
					.send({
						[pinnedOnReleaseField]: null,
					})
					.expect(200);
				await expectResourceToMatch(pineUser, 'device', device.id, {
					[pinnedOnReleaseField]: null,
					...(versions.gt(version, 'v6') && {
						should_be_running__release: { __id: expectedLatest.id },
					}),
				});
			});

			it('Should update latest release to a newly-marked final release', async () => {
				const expectedLatest = fx.releases.release2;
				await supertest(admin)
					.patch(`/${version}/release(${expectedLatest.id})`)
					.send({
						is_final: true,
						start_timestamp: Date.now(),
					})
					.expect(200);
				const stateV2 = await device.getStateV2();
				expect(
					stateV2.local.apps[applicationId].releaseId,
					'v2 target state should return correct release',
				).to.equal(expectedLatest.id);

				const stateV3 = await device.getStateV3();
				expect(
					stateV3[device.uuid].apps[appUuid].releases,
					'v3 target state should return correct release',
				)
					.to.have.property(expectedLatest.commit)
					.that.has.property('id')
					.that.equals(expectedLatest.id);
			});

			it('Should update latest release to a release now passing tests', async () => {
				const expectedLatest = fx.releases.release3;
				await supertest(admin)
					.patch(`/${version}/release(${expectedLatest.id})`)
					.send({
						is_passing_tests: true,
						start_timestamp: Date.now(),
					})
					.expect(200);
				const stateV2 = await device.getStateV2();
				expect(
					stateV2.local.apps[applicationId].releaseId,
					'v2 target state should return correct release',
				).to.equal(expectedLatest.id);

				const stateV3 = await device.getStateV3();
				expect(
					stateV3[device.uuid].apps[appUuid].releases,
					'v3 target state should return correct release',
				)
					.to.have.property(expectedLatest.commit)
					.that.has.property('id')
					.that.equals(expectedLatest.id);
			});

			it('Should update latest release to previous final release passing tests', async () => {
				const expectedLatest = fx.releases.release2;
				await supertest(admin)
					.patch(`/${version}/release(${fx.releases.release3.id})`)
					.send({
						is_passing_tests: false,
					})
					.expect(200);
				const stateV2 = await device.getStateV2();
				expect(
					stateV2.local.apps[applicationId].releaseId,
					'v2 target state should return correct release',
				).to.equal(expectedLatest.id);

				const stateV3 = await device.getStateV3();
				expect(
					stateV3[device.uuid].apps[appUuid].releases,
					'v3 target state should return correct release',
				)
					.to.have.property(expectedLatest.commit)
					.that.has.property('id')
					.that.equals(expectedLatest.id);
			});

			describe('given two releases of two applications building in parallel', function () {
				// used to create unique commits for each set of releases
				let testRunsCount = 0;
				let app1Release: Release['Read'];
				let app2Release: Release['Read'];

				beforeEach(async function () {
					testRunsCount++;

					assertExists(admin.id);
					app1Release = await addReleaseToApp(admin, {
						belongs_to__application: applicationId,
						is_created_by__user: admin.id,
						build_log: '',
						commit: `deadbeef${testRunsCount}`,
						composition: {},
						source: '',
						status: 'running',
						start_timestamp: Date.now(),
					});

					app2Release = await addReleaseToApp(admin, {
						belongs_to__application: application2Id,
						is_created_by__user: admin.id,
						build_log: '',
						commit: `deadbeef${testRunsCount}`,
						composition: {},
						source: '',
						status: 'running',
						start_timestamp: Date.now(),
					});
				});

				it('should update the target release of both apps when the releases complete in order', async function () {
					await supertest(admin)
						.patch(`/${version}/release(${app1Release.id})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);

					await supertest(admin)
						.patch(`/${version}/release(${app2Release.id})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);

					const device1stateV2 = await device.getStateV2();
					expect(
						device1stateV2.local.apps[applicationId].releaseId,
						'v2 target state should return correct release for device 1',
					).to.equal(app1Release.id);
					const device2stateV2 = await device2.getStateV2();
					expect(
						device2stateV2.local.apps[application2Id].releaseId,
						'v2 target state should return correct release for device 2',
					).to.equal(app2Release.id);

					const device1stateV3 = await device.getStateV3();
					expect(
						device1stateV3[device.uuid].apps[appUuid].releases,
						'v3 target state should return correct release for device 1',
					)
						.to.have.property(app1Release.commit)
						.that.has.property('id')
						.that.equals(app1Release.id);
					const device2stateV3 = await device2.getStateV3();
					expect(
						device2stateV3[device2.uuid].apps[app2Uuid].releases,
						'v3 target state should return correct release for device 2',
					)
						.to.have.property(app2Release.commit)
						.that.has.property('id')
						.that.equals(app2Release.id);
				});

				it('should update the target release of both apps when the the later release finishes before the first one', async function () {
					await supertest(admin)
						.patch(`/${version}/release(${app2Release.id})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);

					await supertest(admin)
						.patch(`/${version}/release(${app1Release.id})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);

					const device1stateV2 = await device.getStateV2();
					expect(
						device1stateV2.local.apps[applicationId].releaseId,
						'v2 target state should return correct release for device 1',
					).to.equal(app1Release.id);
					const device2stateV2 = await device2.getStateV2();
					expect(
						device2stateV2.local.apps[application2Id].releaseId,
						'v2 target state should return correct release for device 2',
					).to.equal(app2Release.id);

					const device1stateV3 = await device.getStateV3();
					expect(
						device1stateV3[device.uuid].apps[appUuid].releases,
						'v3 target state should return correct release for device 1',
					)
						.to.have.property(app1Release.commit)
						.that.has.property('id')
						.that.equals(app1Release.id);
					const device2stateV3 = await device2.getStateV3();
					expect(
						device2stateV3[device2.uuid].apps[app2Uuid].releases,
						'v3 target state should return correct release for device 2',
					)
						.to.have.property(app2Release.commit)
						.that.has.property('id')
						.that.equals(app2Release.id);
				});
			});

			describe('given an app that does not track the latest release', function () {
				let app3ReleaseId: number;
				let app4ReleaseId: number;
				let app5ReleaseId: number;
				let appToDeleteRelease1Id: number;

				before(async function () {
					const org = await fx.organizations.admin;
					const { body: deviceType } = await pineUser
						.get<DeviceType['Read']>({
							resource: 'device_type',
							id: { slug: 'intel-nuc' },
							options: { $select: 'id' },
						})
						.expect(200);
					const { body: application } = await pineUser
						.post({
							resource: 'application',
							body: {
								app_name: 'application_to_delete',
								organization: org.id,
								is_for__device_type: deviceType.id,
							},
						})
						.expect(201);
					applicationToDelete = application as Application['Read'];

					device5 = await fakeDevice.provisionDevice(
						admin,
						applicationToDelete.id,
					);

					await supertest(admin)
						.patch(`/${version}/application(${application3Id})`)
						.send({
							should_track_latest_release: false,
						})
						.expect(200);

					assertExists(admin.id);

					const app3Release = await addReleaseToApp(admin, {
						belongs_to__application: application3Id,
						is_created_by__user: admin.id,
						build_log: '',
						commit: `deadbeef`,
						composition: {},
						source: '',
						status: 'running',
						start_timestamp: Date.now(),
						semver: '9.9.9',
					});
					app3ReleaseId = app3Release.id;
					const app4Release = await addReleaseToApp(admin, {
						belongs_to__application: application3Id,
						is_created_by__user: admin.id,
						build_log: '',
						commit: `deadbeef2`,
						composition: {},
						source: '',
						status: 'running',
						start_timestamp: Date.now(),
					});
					app4ReleaseId = app4Release.id;
					const app5Release = await addReleaseToApp(admin, {
						belongs_to__application: application3Id,
						is_created_by__user: admin.id,
						build_log: '',
						commit: `deadbeef3`,
						composition: {},
						source: '',
						status: 'running',
						start_timestamp: Date.now(),
					});
					app5ReleaseId = app5Release.id;
					const appToDeleteRelease1 = await addReleaseToApp(admin, {
						belongs_to__application: applicationToDelete.id,
						is_created_by__user: admin.id,
						build_log: '',
						commit: `deadbeef4`,
						composition: {},
						source: '',
						status: 'running',
						start_timestamp: Date.now(),
					});
					appToDeleteRelease1Id = appToDeleteRelease1.id;

					const { id: serviceId } = await addServiceToApp(
						admin,
						'new-untracked-release-service',
						application3Id,
					);

					const { id: imageId } = await addImageToService(admin, {
						is_a_build_of__service: serviceId,
						build_log: '',
						start_timestamp: Date.now(),
						end_timestamp: Date.now(),
						push_timestamp: Date.now(),
						image_size: 1024,
						status: 'success',
					});
					await addImageToRelease(admin, imageId, app3ReleaseId);
					await addImageToRelease(admin, imageId, app4ReleaseId);
					await addImageToRelease(admin, imageId, app5ReleaseId);

					await supertest(admin)
						.patch(`/${version}/release(${app3ReleaseId})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);
					await supertest(admin)
						.patch(`/${version}/release(${app4ReleaseId})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);
					await supertest(admin)
						.patch(`/${version}/release(${app5ReleaseId})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);
					await supertest(admin)
						.patch(`/${version}/release(${appToDeleteRelease1Id})`)
						.send({
							status: 'success',
							end_timestamp: Date.now(),
						})
						.expect(200);
				});

				it('should add any new service installs of the new release when a device is self-pinned to it', async function () {
					const {
						body: { d: serviceInstallsBefore },
					} = await supertest(admin)
						.get(
							`/${version}/service_install?$select=id&$expand=installs__service($select=service_name)&$filter=device eq ${device4.id}`,
						)
						.expect(200);

					expect(serviceInstallsBefore).to.be.an('array');
					const serviceNamesBefore = serviceInstallsBefore.map(
						(si: AnyObject) => si.installs__service[0].service_name,
					);
					expect(serviceNamesBefore).to.not.include(
						'new-untracked-release-service',
					);

					await expectToEventually(async () => {
						await supertest(device4)
							.patch(`/${version}/device(${device4.id})`)
							.send({
								[pinnedOnReleaseField]: app3ReleaseId,
							})
							.expect(200);

						const {
							body: { d: serviceInstallsAfter },
						} = await supertest(admin)
							.get(
								`/${version}/service_install?$select=id&$expand=installs__service($select=service_name)&$filter=device eq ${device4.id}`,
							)
							.expect(200);

						expect(serviceInstallsAfter).to.be.an('array');
						const serviceNamesAfter = serviceInstallsAfter.map(
							(si: AnyObject) => si.installs__service[0].service_name,
						);
						expect(serviceNamesAfter).to.include(
							'new-untracked-release-service',
						);
					});
				});

				it('should notify the supervisor when a device is self-pinned to a release', async function () {
					await connectDeviceAndWaitForUpdate(
						device4.uuid,
						version,
						async () => {
							await supertest(device4)
								.patch(`/${version}/device(${device4.id})`)
								.send({
									[pinnedOnReleaseField]: app3ReleaseId,
								})
								.expect(200);
						},
					);
				});

				it('should not update the target release', async function () {
					const expectedApp3Latest = fx.releases.app3release1;

					const device3stateV2 = await device3.getStateV2();
					expect(device3stateV2.local.apps[application3Id].releaseId).to.equal(
						expectedApp3Latest.id,
					);

					const device3stateV3 = await device3.getStateV3();
					expect(device3stateV3[device3.uuid].apps[app3Uuid].releases)
						.to.have.property(expectedApp3Latest.commit)
						.that.has.property('id')
						.that.equals(expectedApp3Latest.id);
				});

				it('should add any new service installs of the new release at the point it is actually pinned', async function () {
					const {
						body: { d: serviceInstallsBefore },
					} = await supertest(admin)
						.get(
							`/${version}/service_install?$select=id&$expand=installs__service($select=service_name)&$filter=device eq ${device3.id}`,
						)
						.expect(200);

					expect(serviceInstallsBefore).to.be.an('array');
					const serviceNamesBefore = serviceInstallsBefore.map(
						(si: AnyObject) => si.installs__service[0].service_name,
					);
					expect(serviceNamesBefore).to.not.include(
						'new-untracked-release-service',
					);

					await supertest(admin)
						.patch(`/${version}/application(${application3Id})`)
						.send({
							should_be_running__release: app3ReleaseId,
						})
						.expect(200);

					await expectToEventually(async () => {
						const {
							body: { d: serviceInstallsAfter },
						} = await supertest(admin)
							.get(
								`/${version}/service_install?$select=id&$expand=installs__service($select=service_name)&$filter=device eq ${device3.id}`,
							)
							.expect(200);

						expect(serviceInstallsAfter).to.be.an('array');
						const serviceNamesAfter = serviceInstallsAfter.map(
							(si: AnyObject) => si.installs__service[0].service_name,
						);
						expect(serviceNamesAfter).to.include(
							'new-untracked-release-service',
						);
					});
				});

				it('should notify the supervisor when pinning the application to a release pinned', async function () {
					await connectDeviceAndWaitForUpdate(
						device3.uuid,
						version,
						async () => {
							await supertest(admin)
								.patch(`/${version}/application(${application3Id})`)
								.send({
									should_be_running__release: app3ReleaseId,
								})
								.expect(200);
						},
					);
				});

				it('should not be able to delete a release if a fleet is pinned to it', async function () {
					await supertest(admin)
						.delete(`/${version}/release(${app3ReleaseId})`)
						.expect(
							400,
							'"Unable to delete release 9.9.9 because it is the fleet\'s target release."',
						);
				});

				it('should not be able to delete a release if a device is pinned to it', async function () {
					await supertest(admin)
						.patch(`/${version}/device(${device4.id})`)
						.send({ [pinnedOnReleaseField]: app4ReleaseId });
					await supertest(admin)
						.delete(`/${version}/release(${app4ReleaseId})`)
						.expect(
							400,
							'"Unable to delete a release because device(s) are pinned to it."',
						);
				});

				it('should be able to delete a release that is reported to be running on a device if the device is not pinned to it and the application is not tracking it', async function () {
					await pineUser
						.patch({
							resource: 'device',
							id: device4.id,
							body: {
								is_running__release: app5ReleaseId,
							},
						})
						.expect(200);
					await pineUser
						.delete({ resource: 'release', id: app5ReleaseId })
						.expect(200);
				});

				it('should be able to delete an application1 where a device that is running application1.release has been moved to another application2', async function () {
					await pineUser
						.patch({
							resource: 'device',
							id: device5.id,
							body: {
								is_running__release: appToDeleteRelease1Id,
							},
						})
						.expect(200);
					await pineUser.patch({
						resource: 'device',
						id: device5.id,
						body: { belongs_to__application: application3Id },
					});
					await pineUser
						.delete({ resource: 'application', id: applicationToDelete.id })
						.expect(200);
				});
			});
		});
	});
};
