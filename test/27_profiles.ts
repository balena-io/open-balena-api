import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import * as fakeDevice from './test-lib/fake-device.js';
import { assertExists } from './test-lib/common.js';
import { expectResourceToMatch } from './test-lib/api-helpers.js';
import * as versions from './test-lib/versions.js';

export default () => {
	versions.test((version, pineTest) => {
		if (versions.lt(version, 'resin')) {
			return;
		}
		describe('profiles', function () {
			let pineUser: typeof pineTest;

			before(async function () {
				const fx = await fixtures.load('27-profiles');

				this.loadedFixtures = fx;
				this.user = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: { user: this.user },
				});
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

			describe('application profile catalog', function () {
				let catalogTestImageProfile1Id: number;
				let catalogTestImageProfile2Id: number;
				let catalogTestEntryId: number;

				it('should be able to read a pre-existing catalog entry created for the pre-existing image_profile fixtures', async function () {
					await expectResourceToMatch(
						pineUser,
						'application_profile_catalog',
						{
							application: this.hostApp.id,
							catalogs__profile_name: 'bluetooth',
						},
						{
							catalogs__profile_name: 'bluetooth',
							description: null,
						},
					);
				});

				it('should create a catalog entry when an image_profile is created', async function () {
					const { body: imageProfile } = await pineUser
						.post({
							resource: 'image_profile',
							body: {
								release_image: this.releaseImage1.id,
								profile_name: 'catalog-test',
							},
						})
						.expect(201);
					catalogTestImageProfile1Id = imageProfile.id;

					const { body: catalogEntry } = await pineUser
						.get({
							resource: 'application_profile_catalog',
							id: {
								application: this.app1.id,
								catalogs__profile_name: 'catalog-test',
							},
							options: { $select: 'id' },
						})
						.expect(200);
					assertExists(catalogEntry);
					catalogTestEntryId = catalogEntry.id;
				});

				it('should not create a second catalog entry for another image_profile with the same profile name', async function () {
					const { body: imageProfile } = await pineUser
						.post({
							resource: 'image_profile',
							body: {
								release_image: this.releaseImage2.id,
								profile_name: 'catalog-test',
							},
						})
						.expect(201);
					catalogTestImageProfile2Id = imageProfile.id;

					const { body: catalogEntries } = await pineUser
						.get({
							resource: 'application_profile_catalog',
							options: {
								$select: 'id',
								$filter: {
									application: this.app1.id,
									catalogs__profile_name: 'catalog-test',
								},
							},
						})
						.expect(200);
					expect(catalogEntries).to.have.lengthOf(1);
					expect(catalogEntries[0]).to.have.property('id', catalogTestEntryId);
				});

				it('should maintain a single catalog entry when image_profiles with the same profile name are created and deleted concurrently', async function () {
					const [{ body: imageProfile1 }, { body: imageProfile2 }] =
						await Promise.all([
							pineUser
								.post({
									resource: 'image_profile',
									body: {
										release_image: this.releaseImage1.id,
										profile_name: 'catalog-test-concurrent',
									},
								})
								.expect(201),
							pineUser
								.post({
									resource: 'image_profile',
									body: {
										release_image: this.releaseImage2.id,
										profile_name: 'catalog-test-concurrent',
									},
								})
								.expect(201),
						]);
					expect(imageProfile1.id).to.not.equal(imageProfile2.id);

					const { body: catalogEntries } = await pineUser
						.get({
							resource: 'application_profile_catalog',
							options: {
								$select: 'id',
								$filter: {
									application: this.app1.id,
									catalogs__profile_name: 'catalog-test-concurrent',
								},
							},
						})
						.expect(200);
					expect(catalogEntries).to.have.lengthOf(1);

					await Promise.all([
						pineUser
							.delete({ resource: 'image_profile', id: imageProfile1.id })
							.expect(200),
						pineUser
							.delete({ resource: 'image_profile', id: imageProfile2.id })
							.expect(200),
					]);

					const { body: remainingCatalogEntries } = await pineUser
						.get({
							resource: 'application_profile_catalog',
							options: {
								$select: 'id',
								$filter: {
									application: this.app1.id,
									catalogs__profile_name: 'catalog-test-concurrent',
								},
							},
						})
						.expect(200);
					expect(remainingCatalogEntries).to.have.lengthOf(0);
				});

				it('should allow updating a catalog entry description', async function () {
					await pineUser
						.patch({
							resource: 'application_profile_catalog',
							id: catalogTestEntryId,
							body: { description: 'Test profile used for catalog coverage' },
						})
						.expect(200);

					await expectResourceToMatch(
						pineUser,
						'application_profile_catalog',
						catalogTestEntryId,
						{ description: 'Test profile used for catalog coverage' },
					);
				});

				it('should not allow a client to create a catalog entry directly', async function () {
					await pineUser
						.post({
							resource: 'application_profile_catalog',
							body: {
								application: this.app1.id,
								catalogs__profile_name: 'client-created',
							},
						})
						.expect(401);
				});

				it('should not allow a client to delete a catalog entry directly', async function () {
					await pineUser
						.delete({
							resource: 'application_profile_catalog',
							id: catalogTestEntryId,
						})
						.expect(401);
				});

				it('should keep the catalog entry while another image_profile with the same name still exists', async function () {
					await pineUser
						.delete({
							resource: 'image_profile',
							id: catalogTestImageProfile1Id,
						})
						.expect(200);

					const { body: catalogEntry } = await pineUser
						.get({
							resource: 'application_profile_catalog',
							id: catalogTestEntryId,
							options: { $select: 'id' },
						})
						.expect(200);
					expect(catalogEntry).to.not.be.undefined;
				});

				it('should delete the catalog entry once no image_profile references it anymore', async function () {
					await pineUser
						.delete({
							resource: 'image_profile',
							id: catalogTestImageProfile2Id,
						})
						.expect(200);

					const { body: catalogEntry } = await pineUser
						.get({
							resource: 'application_profile_catalog',
							id: catalogTestEntryId,
							options: { $select: 'id' },
						})
						.expect(200);
					expect(catalogEntry).to.be.undefined;
				});
			});
			describe('image profile', function () {
				describe('create image profile', function () {
					it('should succeed with mandatory properties', async function () {
						const { body: imageProfile } = await pineUser
							.post({
								resource: 'image_profile',
								body: {
									release_image: this.releaseImage1.id,
									profile_name: 'kernel-modules',
								},
							})
							.expect(201);

						expect(imageProfile).to.have.property('id').that.is.a('number');
						expect(imageProfile)
							.to.have.nested.property('release_image.__id')
							.that.equals(this.releaseImage1.id);
						expect(imageProfile.profile_name).to.equal('kernel-modules');
					});

					it('should fail when using a duplicated profile name for the same release image', async function () {
						await pineUser
							.post({
								resource: 'image_profile',
								body: {
									release_image: this.releaseImage1.id,
									profile_name: 'kernel-modules',
								},
							})
							.expect(409);
					});

					it('should allow the same profile name on a different release image', async function () {
						const { body: imageProfile } = await pineUser
							.post({
								resource: 'image_profile',
								body: {
									release_image: this.releaseImage2.id,
									profile_name: 'kernel-modules',
								},
							})
							.expect(201);

						expect(imageProfile)
							.to.have.nested.property('release_image.__id')
							.that.equals(this.releaseImage2.id);
					});

					it('should support profile names with letters, numbers, underscores, periods and hyphens', async function () {
						const { body: imageProfile } = await pineUser
							.post({
								resource: 'image_profile',
								body: {
									release_image: this.releaseImage1.id,
									profile_name: '0Debug_profile.v2-test',
								},
							})
							.expect(201);

						expect(imageProfile.profile_name).to.equal(
							'0Debug_profile.v2-test',
						);
					});
				});

				describe('image profile name validation', function () {
					const expectRejectedProfileName = async (
						releaseImageId: number,
						profileName: string,
					) => {
						await pineUser
							.post({
								resource: 'image_profile',
								body: {
									release_image: releaseImageId,
									profile_name: profileName,
								},
							})
							.expect(400);
					};

					it('should reject an empty profile name', async function () {
						await expectRejectedProfileName(this.releaseImage1.id, '');
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
								this.releaseImage1.id,
								invalidProfileName,
							);
						});
					}

					it('should reject profile names longer than 100 characters', async function () {
						await expectRejectedProfileName(
							this.releaseImage1.id,
							'a'.repeat(101),
						);
					});

					it('should reject updating a profile name to an invalid one', async function () {
						await pineUser
							.patch({
								resource: 'image_profile',
								id: this.metricsProfile.id,
								body: {
									profile_name: 'not valid',
								},
							})
							.expect(400);
					});
				});

				describe('retrieve image profile', function () {
					it('should succeed when retrieving the image profiles of a release image', async function () {
						const { body: imageProfiles } = await pineUser
							.get({
								resource: 'image_profile',
								options: {
									$select: ['id', 'profile_name'],
									$filter: { release_image: this.releaseImage2.id },
									$orderby: { profile_name: 'asc' },
								},
							})
							.expect(200);

						expect(imageProfiles).to.be.an('array');
						expect(
							imageProfiles.map((imageProfile) => imageProfile.profile_name),
						).to.deep.equal(['kernel-modules', 'metrics']);
					});

					it('should succeed when expanding the image profiles from a release', async function () {
						const { body: release } = await pineUser
							.get({
								resource: 'release',
								id: this.release1.id,
								options: {
									$select: 'id',
									$expand: {
										release_image: {
											$select: 'id',
											$expand: {
												image_profile: { $select: ['id', 'profile_name'] },
											},
										},
									},
								},
							})
							.expect(200);

						assertExists(release);
						const profileNames = release.release_image
							.flatMap((releaseImage) =>
								releaseImage.image_profile.map(
									(imageProfile) => imageProfile.profile_name,
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
						const { body: imageProfile } = await pineTest
							.get({
								resource: 'image_profile',
								id: this.hostAppProfile.id,
								options: { $select: ['id', 'profile_name'] },
							})
							.expect(200);

						assertExists(imageProfile);
						expect(imageProfile.profile_name).to.equal('bluetooth');
					});

					it('should not allow guest users to read image profiles from non-public applications', async function () {
						const { body: imageProfile } = await pineTest
							.get({
								resource: 'image_profile',
								id: this.metricsProfile.id,
								options: { $select: 'id' },
							})
							.expect(200);

						expect(imageProfile).to.be.undefined;
					});

					it('should not allow guest users to create image profiles', async function () {
						await pineTest
							.post({
								resource: 'image_profile',
								body: {
									release_image: this.releaseImage1.id,
									profile_name: 'guest-profile',
								},
							})
							.expect(401);
					});
				});

				describe('delete image profile', function () {
					it('should succeed when deleting an image profile', async function () {
						const { body: imageProfile } = await pineUser
							.post({
								resource: 'image_profile',
								body: {
									release_image: this.releaseImage1.id,
									profile_name: 'to-be-deleted',
								},
							})
							.expect(201);

						await pineUser
							.delete({
								resource: 'image_profile',
								id: imageProfile.id,
							})
							.expect(200);

						const { body: deletedImageProfile } = await pineUser
							.get({
								resource: 'image_profile',
								id: imageProfile.id,
								options: { $select: 'id' },
							})
							.expect(200);
						expect(deletedImageProfile).to.be.undefined;
					});

					it('should cascade delete image profiles when their release is deleted', async function () {
						// Unpin the fleet from the release so that it can be deleted
						await pineUser
							.patch({
								resource: 'application',
								id: this.app1.id,
								body: {
									should_track_latest_release: false,
									should_be_running__release: null,
								},
							})
							.expect(200);

						await pineUser
							.delete({
								resource: 'release',
								id: this.release1.id,
							})
							.expect(200);

						const { body: imageProfiles } = await pineUser
							.get({
								resource: 'image_profile',
								options: {
									$select: 'id',
									$filter: {
										release_image: {
											$in: [this.releaseImage1.id, this.releaseImage2.id],
										},
									},
								},
							})
							.expect(200);

						expect(imageProfiles).to.have.lengthOf(0);
					});
				});
			});

			describe('application profile', function () {
				it('should activate a profile of a hostApp for a fleet', async function () {
					const { body: applicationProfile } = await pineUser
						.post({
							resource: 'application_profile',
							body: {
								application: this.app1.id,
								activates__profile_name: 'kernel-modules',
								on__application: this.hostApp.id,
							},
						})
						.expect(201);

					expect(applicationProfile)
						.to.have.nested.property('application.__id')
						.that.equals(this.app1.id);
					expect(applicationProfile)
						.to.have.nested.property('on__application.__id')
						.that.equals(this.hostApp.id);
					expect(applicationProfile.activates__profile_name).to.equal(
						'kernel-modules',
					);
				});

				it('should reject a duplicated activation for the same fleet/profile/hostApp', async function () {
					await pineUser
						.post({
							resource: 'application_profile',
							body: {
								application: this.app1.id,
								activates__profile_name: 'kernel-modules',
								on__application: this.hostApp.id,
							},
						})
						.expect(409);
				});

				it('should reject an activator that is not a fleet', async function () {
					await pineUser
						.post({
							resource: 'application_profile',
							body: {
								application: this.blockApp.id,
								activates__profile_name: 'kernel-modules',
								on__application: this.hostApp.id,
							},
						})
						.expect(400);
				});

				it('should reject a target application that is not a hostApp', async function () {
					await pineUser
						.post({
							resource: 'application_profile',
							body: {
								application: this.app1.id,
								activates__profile_name: 'kernel-modules',
								on__application: this.app1.id,
							},
						})
						.expect(400);
				});

				it('should reject a target application that is a block', async function () {
					await pineUser
						.post({
							resource: 'application_profile',
							body: {
								application: this.app1.id,
								activates__profile_name: 'kernel-modules',
								on__application: this.blockApp.id,
							},
						})
						.expect(400);
				});

				it('should reject an invalid profile name', async function () {
					await pineUser
						.post({
							resource: 'application_profile',
							body: {
								application: this.app1.id,
								activates__profile_name: 'has space',
								on__application: this.hostApp.id,
							},
						})
						.expect(400);
				});

				it('should retrieve the activations targeting a hostApp', async function () {
					const { body: applicationProfiles } = await pineUser
						.get({
							resource: 'application_profile',
							options: {
								$select: 'activates__profile_name',
								$filter: { on__application: this.hostApp.id },
								$orderby: { activates__profile_name: 'asc' },
							},
						})
						.expect(200);

					expect(
						applicationProfiles.map(
							(activation) => activation.activates__profile_name,
						),
					).to.deep.equal(['kernel-modules', 'metrics']);
				});

				it('should not allow guest users to create activations', async function () {
					await pineTest
						.post({
							resource: 'application_profile',
							body: {
								application: this.app1.id,
								activates__profile_name: 'guest-profile',
								on__application: this.hostApp.id,
							},
						})
						.expect(401);
				});
			});

			describe('device profile override', function () {
				it('should succeed with mandatory properties', async function () {
					const { body: deviceOverride } = await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'kernel-modules',
								on__application: this.hostApp.id,
								is_active: true,
							},
						})
						.expect(201);

					expect(deviceOverride).to.deep.include({
						device: { __id: this.hostAppOperatedDevice.id },
						on__application: { __id: this.hostApp.id },
						overrides__profile_name: 'kernel-modules',
						is_active: true,
					});
				});

				it('should reject a duplicated override for the same device/profile/application', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'kernel-modules',
								on__application: this.hostApp.id,
								is_active: false,
							},
						})
						.expect(409);
				});

				it('should reject a device_profile_override that is for a different hostApp than the one operating the device', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.app1Device.id,
								overrides__profile_name: 'debug',
								on__application: this.hostApp.id,
								is_active: true,
							},
						})
						.expect(400);
				});

				it('should reject a target application that is not a hostApp', async function () {
					expect(this.app1Device).to.have.nested.property(
						'belongs_to__application.__id',
						this.app1.id,
					);

					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.app1Device.id,
								overrides__profile_name: 'debug',
								on__application: this.app1.id,
								is_active: true,
							},
						})
						.expect(400);
				});

				it('should reject a target application that is a block', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.blockAppDevice.id,
								overrides__profile_name: 'debug',
								on__application: this.blockApp.id,
								is_active: true,
							},
						})
						.expect(400);
				});

				it('should reject an invalid profile name', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'has space',
								on__application: this.hostApp.id,
								is_active: true,
							},
						})
						.expect(400);
				});

				it('should reject a create that omits is_active', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'no-is-active',
								on__application: this.hostApp.id,
							},
						})
						.expect(400);
				});

				it('should reject a non-boolean is_active', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'non-boolean-is-active',
								on__application: this.hostApp.id,
								is_active: 'yes',
							},
						})
						.expect(400);
				});

				it('should allow updating is_active', async function () {
					const { body: created } = await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'updatable',
								on__application: this.hostApp.id,
								is_active: true,
							},
						})
						.expect(201);

					await pineUser
						.patch({
							resource: 'device_profile_override',
							id: created.id,
							body: {
								is_active: false,
							},
						})
						.expect(200);

					await expectResourceToMatch(
						pineUser,
						'device_profile_override',
						created.id,
						{
							is_active: false,
						},
					);
				});

				it('should retrieve the overrides targeting an application', async function () {
					const { body: overrides } = await pineUser
						.get({
							resource: 'device_profile_override',
							options: {
								$select: 'overrides__profile_name',
								$filter: { on__application: this.hostApp.id },
								$orderby: { overrides__profile_name: 'asc' },
							},
						})
						.expect(200);

					expect(
						overrides.map(
							(deviceOverride) => deviceOverride.overrides__profile_name,
						),
					).to.deep.equal(['kernel-modules', 'metrics', 'updatable']);
				});

				it('should not allow guest users to create overrides', async function () {
					await pineTest
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.hostAppOperatedDevice.id,
								overrides__profile_name: 'guest-profile',
								on__application: this.hostApp.id,
								is_active: true,
							},
						})
						.expect(401);
				});

				it('should cascade delete device profile overrides when the device is deleted', async function () {
					const tempDevice = await fakeDevice.provisionDevice(
						this.user,
						this.app1.id,
					);
					await pineUser
						.patch({
							resource: 'device',
							id: tempDevice.id,
							body: {
								should_be_operated_by__release: this.hostAppRelease.id,
							},
						})
						.expect(200);

					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: tempDevice.id,
								overrides__profile_name: 'temp-device-profile',
								on__application: this.hostApp.id,
								is_active: true,
							},
						})
						.expect(201);

					await pineUser
						.delete({
							resource: 'device',
							id: tempDevice.id,
						})
						.expect(200);

					const { body: overrides } = await pineUser
						.get({
							resource: 'device_profile_override',
							options: {
								$select: 'id',
								$filter: { device: tempDevice.id },
							},
						})
						.expect(200);
					expect(overrides).to.have.lengthOf(0);
				});

				it('should keep existing overrides valid when the device switches to a different release of the same hostApp (HUP)', async function () {
					await pineUser
						.patch({
							resource: 'device',
							id: this.hostAppOperatedDevice.id,
							body: {
								should_be_operated_by__release: this.hostAppRelease2.id,
							},
						})
						.expect(200);

					const { body: overrides } = await pineUser
						.get({
							resource: 'device_profile_override',
							options: {
								$select: 'id',
								$filter: {
									device: this.hostAppOperatedDevice.id,
									on__application: this.hostApp.id,
								},
							},
						})
						.expect(200);
					expect(overrides).to.have.length.greaterThan(0);

					// Revert so later tests keep operating against the original release.
					await pineUser
						.patch({
							resource: 'device',
							id: this.hostAppOperatedDevice.id,
							body: {
								should_be_operated_by__release: this.hostAppRelease.id,
							},
						})
						.expect(200);
				});

				it('should not allow deleting an application a device profile override still targets', async function () {
					await pineUser
						.post({
							resource: 'device_profile_override',
							body: {
								device: this.app1Device.id,
								overrides__profile_name: 'cascade-profile',
								on__application: this.hostApp3.id,
								is_active: true,
							},
						})
						.expect(201);

					await pineUser
						.delete({
							resource: 'application',
							id: this.hostApp3.id,
						})
						.expect(409);
				});
			});

			describe('cascade delete of runtime profiles', function () {
				it('should cascade delete application profiles when the application is deleted', async function () {
					// Unpin so the fleet (and its releases) can be deleted.
					await pineUser
						.patch({
							resource: 'application',
							id: this.app1.id,
							body: {
								should_track_latest_release: false,
								should_be_running__release: null,
							},
						})
						.expect(200);

					await pineUser
						.delete({
							resource: 'application',
							id: this.app1.id,
						})
						.expect(200);

					const { body: applicationProfiles } = await pineUser
						.get({
							resource: 'application_profile',
							options: {
								$select: 'id',
								$filter: {
									$or: [
										{ application: this.app1.id },
										{ on__application: this.app1.id },
									],
								},
							},
						})
						.expect(200);
					expect(applicationProfiles).to.have.lengthOf(0);
				});
			});
		});
	});
};
