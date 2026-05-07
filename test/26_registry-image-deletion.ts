import * as fixtures from './test-lib/fixtures.js';
import * as registryMock from './test-lib/registry-mock.js';
import { waitFor } from './test-lib/common.js';
import * as versions from './test-lib/versions.js';
import * as config from '../src/lib/config.js';
import { s3Client } from '../src/features/registry/registry.js';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { permissions, sbvrUtils } from '@balena/pinejs';
import {
	expectNewSettledTasks,
	resetLatestTaskIds,
} from './test-lib/api-helpers.js';
import { expect } from 'chai';
import sinon from 'sinon';

const { api } = sbvrUtils;

function stripRegistryHost(location: string) {
	return location.replace(`${config.REGISTRY2_HOST}/`, '');
}

export default () => {
	versions.test((version, pineTest) => {
		// Don't need to test all versions since this is for behind the scenes cleanup.
		if (version !== 'resin') {
			return;
		}

		describe('registry image deletion', () => {
			const ctx: AnyObject = {};
			let pineUser: typeof pineTest;

			async function createImage(
				serviceId: number,
				options?: {
					releaseId?: number;
					stages?: number;
				},
			) {
				const now = new Date();
				const digest = registryMock.genDigest();
				const stages = options?.stages ?? 1;
				const { body: image } = await pineUser.post({
					resource: 'image',
					body: {
						content_hash: digest,
						start_timestamp: now,
						is_a_build_of__service: serviceId,
						status: 'success',
						push_timestamp: now,
					},
				});

				if (options?.releaseId != null) {
					await pineUser.post({
						resource: 'image__is_part_of__release',
						body: {
							image: image.id,
							is_part_of__release: options.releaseId,
						},
					});
				}

				const repository = stripRegistryHost(
					image.is_stored_at__image_location,
				);
				return {
					repository,
					dbImage: image,
					registryImage: registryMock.addImage(repository, digest),
					cacheImages: registryMock.addCacheImages(repository, stages),
				};
			}

			function checkIsDeleted(
				images: Array<Awaited<ReturnType<typeof createImage>>>,
			) {
				return images.every(
					(i) =>
						i.registryImage.isDeleted === true &&
						i.cacheImages.every((ci) => ci.isDeleted === true),
				);
			}

			async function expectSettledTasks(
				images: Array<Awaited<ReturnType<typeof createImage>>>,
			) {
				await expectNewSettledTasks('delete_registry_images', [
					{
						status: 'succeeded',
						is_executed_with__parameter_set: {
							images: images.map((i) => ({
								location: i.dbImage.is_stored_at__image_location,
							})),
						},
					},
				]);
			}

			before(async function () {
				const fx = await fixtures.load('26-registry-image-deletion');
				ctx.fixtures = fx;
				ctx.admin = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: {
						user: ctx.admin,
					},
				});
				ctx.app1 = fx.applications.app1;
				ctx.service1 = fx.services.service1;
				ctx.service2 = fx.services.service2;
				await resetLatestTaskIds('delete_registry_images');

				// Create an image that should not be deleted.
				// If it was marked for deletion via a task, it would
				// cause a test to fail as it would include this image
				// in its is_executed_with__parameter_set.
				ctx.notDeletedImage = await createImage(ctx.service2.id);
			});

			after(async () => {
				delete ctx.fixtures.applications['app1'];
				registryMock.reset();
				await fixtures.clean(ctx.fixtures);
			});

			it('should mark for deletion when an image is deleted', async () => {
				const image = await createImage(ctx.service1.id);
				await pineUser.delete({
					resource: 'image',
					id: image.dbImage.id,
				});

				await waitFor({
					delayMs: 500,
					checkFn: () => checkIsDeleted([image]),
				});
				await expectSettledTasks([image]);
			});

			it('should mark all images in repository for deletion', async () => {
				const imageA = await createImage(ctx.service1.id);

				// Add another image to repository "out-of-band".
				// This represents images that could be pushed
				// directly to the repository by users.
				const imageB = registryMock.addImage(
					imageA.repository,
					registryMock.genDigest(),
				);

				await pineUser.delete({
					resource: 'image',
					id: imageA.dbImage.id,
				});

				await waitFor({
					delayMs: 500,
					checkFn: () => checkIsDeleted([imageA]) && imageB.isDeleted === true,
				});
				await expectSettledTasks([imageA]);
			});

			it('should retry on registry API errors', async () => {
				// We have the mock return 500 on the next delete request
				// which will cause the first task attempt to fail, but
				// the second attempt should succeed.
				registryMock.setNextDeleteResponseCode(500);
				const consoleSpy = sinon.spy(console, 'error');
				try {
					const image = await createImage(ctx.service1.id);
					const [cache] = image.cacheImages;
					await pineUser.delete({
						resource: 'image',
						id: image.dbImage.id,
					});

					await waitFor({
						delayMs: 500,
						checkFn: () => checkIsDeleted([image]),
					});
					await expectSettledTasks([image]);
					sinon.assert.calledWithMatch(
						consoleSpy,
						sinon.match(/Error deleting registry images/),
						sinon.match.has(
							'message',
							sinon.match(
								new RegExp(
									`Failed to mark ${cache.repository}/${cache.digest} for deletion: \\[500\\].*mock error`,
								),
							),
						),
					);
				} finally {
					consoleSpy.restore();
				}
			});

			it('should not fail when image does not exist in registry', async () => {
				const image = await createImage(ctx.service1.id);
				registryMock.deleteImage(image.registryImage);
				await pineUser.delete({
					resource: 'image',
					id: image.dbImage.id,
				});

				await expectSettledTasks([image]);
			});

			it('should not delete from registry if image is still referenced in database', async () => {
				const consoleSpy = sinon.spy(console, 'info');
				try {
					const image = await createImage(ctx.service2.id);

					// Create a deletion task without deleting the DB record.
					// The task should detect the image is still referenced and skip it.
					await api.tasks.post({
						resource: 'task',
						passthrough: { req: permissions.root },
						body: {
							is_executed_by__handler: 'delete_registry_images',
							is_executed_with__parameter_set: {
								images: [
									{
										location: image.dbImage.is_stored_at__image_location,
									},
								],
							},
							attempt_limit: config.ASYNC_TASK_ATTEMPT_LIMIT,
						},
					});

					await expectNewSettledTasks('delete_registry_images', [
						{
							status: 'succeeded',
							is_executed_with__parameter_set: {
								images: [
									{
										location: image.dbImage.is_stored_at__image_location,
									},
								],
							},
						},
					]);
					expect(image.registryImage.isDeleted).to.be.false;
					sinon.assert.calledWithMatch(
						consoleSpy,
						'[delete_registry_images_task] Deleted 0 registry manifests',
					);
				} finally {
					consoleSpy.restore();
				}
			});

			it('should delete multi-stage cache images when an image is deleted', async () => {
				const image = await createImage(ctx.service1.id, {
					stages: 2,
				});
				await pineUser.delete({
					resource: 'image',
					id: image.dbImage.id,
				});

				await waitFor({
					delayMs: 500,
					checkFn: () => checkIsDeleted([image]),
				});
				await expectSettledTasks([image]);
			});

			it('should create a follow-up task when deletion takes too long', async () => {
				const originalMaxTime =
					config.ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS;
				config.TEST_MOCK_ONLY.ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS = 50;

				const consoleSpy = sinon.spy(console, 'info');
				const images = await Promise.all(
					Array.from({ length: 50 }, () => createImage(ctx.service1.id)),
				);

				try {
					await pineUser.delete({
						resource: 'image',
						options: {
							$filter: {
								id: { $in: images.map((i) => i.dbImage.id) },
							},
						},
					});
					await waitFor({
						delayMs: 500,
						checkFn: () => checkIsDeleted(images),
					});

					sinon.assert.calledWithMatch(
						consoleSpy,
						sinon.match(
							'[delete_registry_images_task] Task took too long. Created a new task for the remaining images',
						),
					);
				} finally {
					consoleSpy.restore();
					config.TEST_MOCK_ONLY.ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS =
						originalMaxTime;
					await resetLatestTaskIds('delete_registry_images');
				}
			});

			it('should mark for deletion when images are deleted via a cascade', async () => {
				const createRelease = async () => {
					const now = new Date();
					const { body: release } = await pineUser.post({
						resource: 'release',
						body: {
							belongs_to__application: ctx.app1.id,
							start_timestamp: now,
							end_timestamp: now,
							commit: randomUUID(),
							status: 'success',
							composition: {},
							source: 'local',
						},
					});

					const [image1, image2] = await Promise.all([
						createImage(ctx.service1.id, {
							releaseId: release.id,
						}),
						createImage(ctx.service1.id, {
							releaseId: release.id,
						}),
					]);

					return {
						images: [image1, image2],
					};
				};

				// Create multiple releases for the application.
				const [release1, release2] = await Promise.all([
					createRelease(),
					createRelease(),
				]);

				// Delete the application.
				await pineUser.delete({
					resource: 'application',
					id: ctx.app1.id,
				});

				// Assert all images were marked for deletion.
				const images = [...release1.images, ...release2.images];
				await waitFor({
					delayMs: 500,
					checkFn: () => checkIsDeleted(images),
				});
				await expectSettledTasks(images);
			});

			it('should not mark unrelated images for deletion', () => {
				expect(ctx.notDeletedImage.registryImage.isDeleted).to.be.false;
			});

			it('should list all digests for a given repo and tag', async () => {
				assert(s3Client, 's3Client not defined');

				// Add multiple images with the 'latest' tag.
				const repo = `v2/${randomUUID()}`;
				const digestA = registryMock.genDigest();
				const digestB = registryMock.genDigest();
				registryMock.addImage(repo, digestA, ['latest']);
				registryMock.addImage(repo, digestB, ['latest']);

				// Confirm that all digests are found.
				const digests = await s3Client.listTagDigests(repo, 'latest');
				expect(digests).to.have.lengthOf(2);
				expect(digests).to.have.members([digestA, digestB]);
			});
		});
	});
};
