import * as fixtures from './test-lib/fixtures.ts';
import * as versions from './test-lib/versions.ts';
import { randomUUID } from 'node:crypto';
import { permissions, sbvrUtils } from '@balena/pinejs';
import {
	expectNewSettledTasks,
	resetLatestTaskIds,
} from './test-lib/api-helpers.ts';
import { expect } from 'chai';

const { api } = sbvrUtils;

export default () => {
	versions.test((version, pineTest) => {
		// Don't need to test all versions since this is for behind the scenes cleanup.
		if (version !== 'resin') {
			return;
		}

		describe('orphaned image deletion', () => {
			const ctx: AnyObject = {};
			let pineUser: typeof pineTest;

			async function createRelease(applicationId: number) {
				const now = new Date();
				const { body: release } = await pineUser.post({
					resource: 'release',
					body: {
						belongs_to__application: applicationId,
						start_timestamp: now,
						end_timestamp: now,
						commit: randomUUID(),
						status: 'success',
						composition: {},
						source: 'local',
					},
				});
				return release;
			}

			async function createImage(serviceId: number, releaseIds: number[]) {
				const now = new Date();
				const { body: image } = await pineUser.post({
					resource: 'image',
					body: {
						start_timestamp: now,
						is_a_build_of__service: serviceId,
						status: 'success',
						push_timestamp: now,
					},
				});
				for (const releaseId of releaseIds) {
					await pineUser.post({
						resource: 'image__is_part_of__release',
						body: {
							image: image.id,
							is_part_of__release: releaseId,
						},
					});
				}
				return image;
			}

			async function getImage(imageId: number) {
				return await api.resin.get({
					resource: 'image',
					id: imageId,
					passthrough: { req: permissions.rootRead },
					options: { $select: 'id' },
				});
			}

			async function getReleaseImageIds(releaseId: number) {
				const releaseImages = await api.resin.get({
					resource: 'image__is_part_of__release',
					passthrough: { req: permissions.rootRead },
					options: {
						$select: 'image',
						$filter: { is_part_of__release: releaseId },
					},
				});
				return releaseImages.map((ri) => ri.image.__id);
			}

			before(async function () {
				const fx = await fixtures.load('28-orphaned-image-deletion');
				ctx.fixtures = fx;
				pineUser = pineTest.clone({
					passthrough: {
						user: fx.users.admin,
					},
				});
				ctx.app1 = fx.applications.app1;
				ctx.app2 = fx.applications.app2;
				ctx.service1 = fx.services.service1;
				ctx.service2 = fx.services.service2;

				// Applications always track the latest release on creation, which
				// would make the releases created here undeletable target releases.
				await pineUser
					.patch({
						resource: 'application',
						options: {
							$filter: { id: { $in: [ctx.app1.id, ctx.app2.id] } },
						},
						body: { should_track_latest_release: false },
					})
					.expect(200);
			});

			after(async () => {
				delete ctx.fixtures.applications['app2'];
				await fixtures.clean(ctx.fixtures);
			});

			it('should delete an image that is only part of the deleted release', async () => {
				await resetLatestTaskIds('delete_registry_images');
				const release = await createRelease(ctx.app1.id);
				const image = await createImage(ctx.service1.id, [release.id]);

				await pineUser
					.delete({
						resource: 'release',
						id: release.id,
					})
					.expect(200);

				expect(await getImage(image.id)).to.be.undefined;
				await expectNewSettledTasks('delete_registry_images', [
					{
						status: 'succeeded',
						is_executed_with__parameter_set: {
							images: [{ location: image.is_stored_at__image_location }],
						},
					},
				]);
			});

			it('should not delete an image that is also part of another release', async () => {
				const releaseA = await createRelease(ctx.app1.id);
				const releaseB = await createRelease(ctx.app1.id);
				const image = await createImage(ctx.service1.id, [
					releaseA.id,
					releaseB.id,
				]);

				await pineUser
					.delete({
						resource: 'release',
						id: releaseA.id,
					})
					.expect(200);

				expect(await getImage(image.id)).to.have.property('id', image.id);
				expect(await getReleaseImageIds(releaseA.id)).to.deep.equal([]);
				expect(await getReleaseImageIds(releaseB.id)).to.deep.equal([image.id]);
			});

			it('should delete an image when all of its releases are deleted together', async () => {
				const releaseA = await createRelease(ctx.app1.id);
				const releaseB = await createRelease(ctx.app1.id);
				const image = await createImage(ctx.service1.id, [
					releaseA.id,
					releaseB.id,
				]);

				await pineUser
					.delete({
						resource: 'release',
						options: {
							$filter: { id: { $in: [releaseA.id, releaseB.id] } },
						},
					})
					.expect(200);

				expect(await getImage(image.id)).to.be.undefined;
			});

			it('should mark a directly deleted image for registry deletion once', async () => {
				await resetLatestTaskIds('delete_registry_images');
				const release = await createRelease(ctx.app1.id);
				const image = await createImage(ctx.service1.id, [release.id]);

				await pineUser
					.delete({
						resource: 'image',
						id: image.id,
					})
					.expect(200);

				expect(await getImage(image.id)).to.be.undefined;
				await expectNewSettledTasks('delete_registry_images', [
					{
						status: 'succeeded',
						is_executed_with__parameter_set: {
							images: [{ location: image.is_stored_at__image_location }],
						},
					},
				]);
			});

			it('should delete the release images when the application is deleted', async () => {
				const releaseA = await createRelease(ctx.app2.id);
				const releaseB = await createRelease(ctx.app2.id);
				const imageA = await createImage(ctx.service2.id, [releaseA.id]);
				const sharedImage = await createImage(ctx.service2.id, [
					releaseA.id,
					releaseB.id,
				]);

				await pineUser
					.delete({
						resource: 'application',
						id: ctx.app2.id,
					})
					.expect(200);

				expect(await getImage(imageA.id)).to.be.undefined;
				expect(await getImage(sharedImage.id)).to.be.undefined;
			});
		});
	});
};
