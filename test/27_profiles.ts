import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';

export default () => {
	versions.test((version) => {
		if (versions.lt(version, 'resin')) {
			return;
		}
		describe('profiles', function () {
			before(async function () {
				const fx = await fixtures.load('27-profiles');

				this.loadedFixtures = fx;
				this.user = fx.users.admin;
				this.app1 = fx.applications.app1;
				this.hostApp = fx.applications.hostApp;
				this.blockApp = fx.applications.blockApp;
				this.hostApp3 = fx.applications.hostApp3;
				this.app1Device = fx.devices.app1Device;
				this.hostAppOperatedDevice = fx.devices.hostAppOperatedDevice;
				this.blockAppDevice = fx.devices.blockAppDevice;
				this.release1 = fx.releases.release1;
				this.hostAppRelease = fx.releases.hostApp_release;
				this.hostAppRelease2 = fx.releases.hostApp_release2;
				this.releaseImage1 =
					fx.images.release1_image1.image__is_part_of__release;
				this.releaseImage2 =
					fx.images.release1_image2.image__is_part_of__release;
				this.metricsProfile = fx.image_profiles.metrics_profile;
				this.hostAppProfile = fx.image_profiles.hostApp_profile;
			});

			after(async function () {
				await fixtures.clean(this.loadedFixtures);
			});

			describe('image profile', function () {
				describe('create image profile', function () {
					it('should succeed with mandatory properties', async function () {
						const res = await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: 'kernel-modules',
							})
							.expect(201);

						expect(res.body).to.have.property('id').that.is.a('number');
						expect(res.body)
							.to.have.nested.property('release_image.__id')
							.that.equals(this.releaseImage1.id);
						expect(res.body.profile_name).to.equal('kernel-modules');
					});

					it('should fail when using a duplicated profile name for the same release image', async function () {
						await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: 'kernel-modules',
							})
							.expect(409);
					});

					it('should allow the same profile name on a different release image', async function () {
						const res = await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage2.id,
								profile_name: 'kernel-modules',
							})
							.expect(201);

						expect(res.body)
							.to.have.nested.property('release_image.__id')
							.that.equals(this.releaseImage2.id);
					});

					it('should support profile names with letters, numbers, underscores, periods and hyphens', async function () {
						const res = await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: '0Debug_profile.v2-test',
							})
							.expect(201);

						expect(res.body.profile_name).to.equal('0Debug_profile.v2-test');
					});
				});

				describe('image profile name validation', function () {
					const expectRejectedProfileName = async (
						user: UserObjectParam,
						releaseImageId: number,
						profileName: string,
					) => {
						await supertest(user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: releaseImageId,
								profile_name: profileName,
							})
							.expect(400);
					};

					it('should reject an empty profile name', async function () {
						await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: '',
							})
							.expect(400);
					});

					for (const invalidProfileName of [
						'a',
						'-leading-dash',
						'.leading-period',
						'_leading-underscore',
						'has space',
						'has/slash',
						'has$symbol',
					]) {
						it(`should reject the invalid profile name '${invalidProfileName}'`, async function () {
							await expectRejectedProfileName(
								this.user,
								this.releaseImage1.id,
								invalidProfileName,
							);
						});
					}

					it('should reject profile names longer than 100 characters', async function () {
						await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: 'a'.repeat(101),
							})
							.expect(400);
					});

					it('should reject updating a profile name to an invalid one', async function () {
						await supertest(this.user)
							.patch(`/${version}/image_profile(${this.metricsProfile.id})`)
							.send({
								profile_name: 'not valid',
							})
							.expect(400);
					});
				});

				describe('retrieve image profile', function () {
					it('should succeed when retrieving the image profiles of a release image', async function () {
						const res = await supertest(this.user)
							.get(
								`/${version}/image_profile?$select=id,profile_name&$filter=release_image eq ${this.releaseImage2.id}&$orderby=profile_name asc`,
							)
							.expect(200);

						expect(res.body).to.have.property('d').that.is.an('array');
						expect(
							res.body.d.map(
								(imageProfile: { profile_name: string }) =>
									imageProfile.profile_name,
							),
						).to.deep.equal(['kernel-modules', 'metrics']);
					});

					it('should succeed when expanding the image profiles from a release', async function () {
						const res = await supertest(this.user)
							.get(
								`/${version}/release(${this.release1.id})?$select=id&$expand=release_image($select=id;$expand=image_profile($select=id,profile_name))`,
							)
							.expect(200);

						expect(res.body).to.have.nested.property('d.length', 1);
						const profileNames = res.body.d[0].release_image
							.flatMap((releaseImage: { image_profile: unknown[] }) =>
								releaseImage.image_profile.map(
									(imageProfile: any) => imageProfile.profile_name,
								),
							)
							.sort();
						expect(profileNames).to.deep.equal([
							'0Debug_profile.v2-test',
							'kernel-modules',
							'kernel-modules',
							'metrics',
						]);
					});
				});

				describe('image profile access', function () {
					it('should allow guest users to read image profiles associated with public hostapps', async function () {
						const res = await supertest()
							.get(
								`/${version}/image_profile(${this.hostAppProfile.id})?$select=id,profile_name`,
							)
							.expect(200);

						expect(res.body).to.have.nested.property('d.length', 1);
						expect(res.body)
							.to.have.nested.property('d[0].profile_name')
							.that.equals('bluetooth');
					});

					it('should not allow guest users to read image profiles from non-public applications', async function () {
						const res = await supertest()
							.get(
								`/${version}/image_profile(${this.metricsProfile.id})?$select=id`,
							)
							.expect(200);

						expect(res.body).to.have.nested.property('d.length', 0);
					});

					it('should not allow guest users to create image profiles', async function () {
						await supertest()
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: 'guest-profile',
							})
							.expect(401);
					});
				});

				describe('delete image profile', function () {
					it('should succeed when deleting an image profile', async function () {
						const { body: imageProfile } = await supertest(this.user)
							.post(`/${version}/image_profile`)
							.send({
								release_image: this.releaseImage1.id,
								profile_name: 'to-be-deleted',
							})
							.expect(201);

						await supertest(this.user)
							.delete(`/${version}/image_profile(${imageProfile.id})`)
							.expect(200);

						const res = await supertest(this.user)
							.get(`/${version}/image_profile(${imageProfile.id})?$select=id`)
							.expect(200);
						expect(res.body).to.have.nested.property('d.length', 0);
					});

					it('should cascade delete image profiles when their release is deleted', async function () {
						// Unpin the fleet from the release so that it can be deleted
						await supertest(this.user)
							.patch(`/${version}/application(${this.app1.id})`)
							.send({
								should_track_latest_release: false,
								should_be_running__release: null,
							})
							.expect(200);

						await supertest(this.user)
							.delete(`/${version}/release(${this.release1.id})`)
							.expect(200);

						const res = await supertest(this.user)
							.get(
								`/${version}/image_profile?$select=id&$filter=release_image in (${this.releaseImage1.id},${this.releaseImage2.id})`,
							)
							.expect(200);

						expect(res.body).to.have.nested.property('d.length', 0);
					});
				});
			});

			describe('application profile', function () {
				it('should activate a profile of a hostApp for a fleet', async function () {
					const res = await supertest(this.user)
						.post(`/${version}/application_profile`)
						.send({
							application: this.app1.id,
							activates__profile_name: 'kernel-modules',
							on__application: this.hostApp.id,
						})
						.expect(201);

					expect(res.body)
						.to.have.nested.property('application.__id')
						.that.equals(this.app1.id);
					expect(res.body)
						.to.have.nested.property('on__application.__id')
						.that.equals(this.hostApp.id);
					expect(res.body.activates__profile_name).to.equal('kernel-modules');
				});

				it('should reject a duplicated activation for the same fleet/profile/hostApp', async function () {
					await supertest(this.user)
						.post(`/${version}/application_profile`)
						.send({
							application: this.app1.id,
							activates__profile_name: 'kernel-modules',
							on__application: this.hostApp.id,
						})
						.expect(409);
				});

				it('should reject an activator that is not a fleet', async function () {
					await supertest(this.user)
						.post(`/${version}/application_profile`)
						.send({
							application: this.blockApp.id,
							activates__profile_name: 'kernel-modules',
							on__application: this.hostApp.id,
						})
						.expect(400);
				});

				it('should reject a target application that is not a hostApp', async function () {
					await supertest(this.user)
						.post(`/${version}/application_profile`)
						.send({
							application: this.app1.id,
							activates__profile_name: 'kernel-modules',
							on__application: this.app1.id,
						})
						.expect(400);
				});

				it('should reject a target application that is a block', async function () {
					await supertest(this.user)
						.post(`/${version}/application_profile`)
						.send({
							application: this.app1.id,
							activates__profile_name: 'kernel-modules',
							on__application: this.blockApp.id,
						})
						.expect(400);
				});

				it('should reject an invalid profile name', async function () {
					await supertest(this.user)
						.post(`/${version}/application_profile`)
						.send({
							application: this.app1.id,
							activates__profile_name: 'has space',
							on__application: this.hostApp.id,
						})
						.expect(400);
				});

				it('should retrieve the activations targeting a hostApp', async function () {
					const res = await supertest(this.user)
						.get(
							`/${version}/application_profile?$select=activates__profile_name&$filter=on__application eq ${this.hostApp.id}&$orderby=activates__profile_name asc`,
						)
						.expect(200);

					expect(
						res.body.d.map(
							(activation: { activates__profile_name: string }) =>
								activation.activates__profile_name,
						),
					).to.deep.equal(['kernel-modules', 'metrics']);
				});

				it('should not allow guest users to create activations', async function () {
					await supertest()
						.post(`/${version}/application_profile`)
						.send({
							application: this.app1.id,
							activates__profile_name: 'guest-profile',
							on__application: this.hostApp.id,
						})
						.expect(401);
				});
			});

			describe('device profile override', function () {
				it('should succeed with mandatory properties', async function () {
					const res = await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'kernel-modules',
							on__application: this.hostApp.id,
							is_active: true,
						})
						.expect(201);

					expect(res.body).to.deep.include({
						device: { __id: this.hostAppOperatedDevice.id },
						on__application: { __id: this.hostApp.id },
						overrides__profile_name: 'kernel-modules',
						is_active: true,
					});
				});

				it('should reject a duplicated override for the same device/profile/application', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'kernel-modules',
							on__application: this.hostApp.id,
							is_active: false,
						})
						.expect(409);
				});

				it('should reject a device_profile_override that is for a different hostApp than the one operating the device', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.app1Device.id,
							overrides__profile_name: 'debug',
							on__application: this.hostApp.id,
							is_active: true,
						})
						.expect(400);
				});

				it('should reject a target application that is not a hostApp', async function () {
					expect(this.app1Device).to.have.nested.property(
						'belongs_to__application.__id',
						this.app1.id,
					);

					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.app1Device.id,
							overrides__profile_name: 'debug',
							on__application: this.app1.id,
							is_active: true,
						})
						.expect(400);
				});

				it('should reject a target application that is a block', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.blockAppDevice.id,
							overrides__profile_name: 'debug',
							on__application: this.blockApp.id,
							is_active: true,
						})
						.expect(400);
				});

				it('should reject an invalid profile name', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'has space',
							on__application: this.hostApp.id,
							is_active: true,
						})
						.expect(400);
				});

				it('should reject a create that omits is_active', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'no-is-active',
							on__application: this.hostApp.id,
						})
						.expect(400);
				});

				it('should reject a non-boolean is_active', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'non-boolean-is-active',
							on__application: this.hostApp.id,
							is_active: 'yes',
						})
						.expect(400);
				});

				it('should allow updating is_active', async function () {
					const { body: created } = await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'updatable',
							on__application: this.hostApp.id,
							is_active: true,
						})
						.expect(201);

					await supertest(this.user)
						.patch(`/${version}/device_profile_override(${created.id})`)
						.send({
							is_active: false,
						})
						.expect(200);

					const res = await supertest(this.user)
						.get(
							`/${version}/device_profile_override(${created.id})?$select=is_active`,
						)
						.expect(200);
					expect(res.body).to.have.nested.property('d[0].is_active', false);
				});

				it('should retrieve the overrides targeting an application', async function () {
					const res = await supertest(this.user)
						.get(
							`/${version}/device_profile_override?$select=overrides__profile_name&$filter=on__application eq ${this.hostApp.id}&$orderby=overrides__profile_name asc`,
						)
						.expect(200);

					expect(
						res.body.d.map(
							(override: { overrides__profile_name: string }) =>
								override.overrides__profile_name,
						),
					).to.deep.equal(['kernel-modules', 'metrics', 'updatable']);
				});

				it('should not allow guest users to create overrides', async function () {
					await supertest()
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.hostAppOperatedDevice.id,
							overrides__profile_name: 'guest-profile',
							on__application: this.hostApp.id,
							is_active: true,
						})
						.expect(401);
				});

				it('should cascade delete device profile overrides when the device is deleted', async function () {
					const tempDevice = await fakeDevice.provisionDevice(
						this.user,
						this.app1.id,
					);
					await supertest(this.user)
						.patch(`/${version}/device(${tempDevice.id})`)
						.send({
							should_be_operated_by__release: this.hostAppRelease.id,
						})
						.expect(200);

					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: tempDevice.id,
							overrides__profile_name: 'temp-device-profile',
							on__application: this.hostApp.id,
							is_active: true,
						})
						.expect(201);

					await supertest(this.user)
						.delete(`/${version}/device(${tempDevice.id})`)
						.expect(200);

					const res = await supertest(this.user)
						.get(
							`/${version}/device_profile_override?$select=id&$filter=device eq ${tempDevice.id}`,
						)
						.expect(200);
					expect(res.body).to.have.nested.property('d.length', 0);
				});

				it('should keep existing overrides valid when the device switches to a different release of the same hostApp (HUP)', async function () {
					await supertest(this.user)
						.patch(`/${version}/device(${this.hostAppOperatedDevice.id})`)
						.send({
							should_be_operated_by__release: this.hostAppRelease2.id,
						})
						.expect(200);

					const res = await supertest(this.user)
						.get(
							`/${version}/device_profile_override?$select=id&$filter=device eq ${this.hostAppOperatedDevice.id} and on__application eq ${this.hostApp.id}`,
						)
						.expect(200);
					expect(res.body.d).to.have.length.greaterThan(0);

					// Revert so later tests keep operating against the original release.
					await supertest(this.user)
						.patch(`/${version}/device(${this.hostAppOperatedDevice.id})`)
						.send({
							should_be_operated_by__release: this.hostAppRelease.id,
						})
						.expect(200);
				});

				it('should not allow deleting an application a device profile override still targets', async function () {
					await supertest(this.user)
						.post(`/${version}/device_profile_override`)
						.send({
							device: this.app1Device.id,
							overrides__profile_name: 'cascade-profile',
							on__application: this.hostApp3.id,
							is_active: true,
						})
						.expect(201);

					await supertest(this.user)
						.delete(`/${version}/application(${this.hostApp3.id})`)
						.expect(409);
				});
			});

			describe('cascade delete of runtime profiles', function () {
				it('should cascade delete application profiles when the application is deleted', async function () {
					// Unpin so the fleet (and its releases) can be deleted.
					await supertest(this.user)
						.patch(`/${version}/application(${this.app1.id})`)
						.send({
							should_track_latest_release: false,
							should_be_running__release: null,
						})
						.expect(200);

					await supertest(this.user)
						.delete(`/${version}/application(${this.app1.id})`)
						.expect(200);

					const applicationProfiles = await supertest(this.user)
						.get(
							`/${version}/application_profile?$select=id&$filter=application eq ${this.app1.id} or on__application eq ${this.app1.id}`,
						)
						.expect(200);
					expect(applicationProfiles.body).to.have.nested.property(
						'd.length',
						0,
					);
				});
			});
		});
	});
};
