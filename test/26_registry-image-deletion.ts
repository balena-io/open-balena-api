import * as fixtures from './test-lib/fixtures.js';
import * as registryMock from './test-lib/registry-mock.js';
import { waitFor } from './test-lib/common.js';
import * as config from '../src/lib/config.js';
import { randomUUID } from 'node:crypto';
import { permissions, sbvrUtils } from '@balena/pinejs';
import {
	expectNewSettledTasks,
	resetLatestTaskIds,
} from './test-lib/api-helpers.js';
import { expect } from 'chai';
import sinon from 'sinon';

const { api } = sbvrUtils;

function randomHash() {
	return randomUUID().replace(/-/g, '').toLowerCase();
}

function generateDockerfile(stages: number) {
	const lines: string[] = [];
	for (let stage = 0; stage < stages; stage++) {
		lines.push('FROM node:latest');
	}
	lines.push('# some comment');
	lines.push('CMD ["node", "src/server.js"]');
	return lines.join('\n');
}

async function createImage(
	serviceId: number,
	options?: {
		releaseId?: number;
		stages?: number;
	},
) {
	const now = new Date();
	const stages =
		options?.stages != null && options.stages > 0 ? options.stages : 0;
	const image = await api.resin.post({
		resource: 'image',
		passthrough: { req: permissions.root },
		body: {
			content_hash: `sha256:${randomHash()}`,
			start_timestamp: now,
			is_a_build_of__service: serviceId,
			status: 'success',
			push_timestamp: now,
			dockerfile: stages > 0 ? generateDockerfile(stages) : null,
		},
	});

	if (options?.releaseId != null) {
		await api.resin.post({
			resource: 'image__is_part_of__release',
			passthrough: { req: permissions.root },
			body: {
				image: image.id,
				is_part_of__release: options.releaseId,
			},
		});
	}

	return {
		dbImage: image,
		registryImage: registryMock.addImage(image),
		cacheImages: stages > 0 ? registryMock.addCacheImages(image, stages) : [],
	};
}

async function createRelease(appId: number, serviceId: number) {
	const now = new Date();
	const release = await api.resin.post({
		resource: 'release',
		passthrough: { req: permissions.root },
		body: {
			belongs_to__application: appId,
			start_timestamp: now,
			end_timestamp: now,
			commit: randomHash(),
			status: 'success',
			composition: {},
			source: 'local',
		},
	});

	const [image1, image2] = await Promise.all([
		createImage(serviceId, {
			releaseId: release.id,
		}),
		createImage(serviceId, {
			releaseId: release.id,
		}),
	]);

	return {
		release,
		images: [image1, image2],
	};
}

function stripRegistryHost(location: string) {
	return location.replace(`${config.REGISTRY2_HOST}/`, '');
}

async function expectSettledTasks(
	images: Array<Awaited<ReturnType<typeof createImage>>>,
) {
	await expectNewSettledTasks('delete_registry_images', [
		{
			status: 'succeeded',
			is_executed_with__parameter_set: {
				images: images.map((i) => [
					i.dbImage.is_stored_at__image_location,
					i.dbImage.content_hash!,
					i.cacheImages.length,
				]),
			},
		},
	]);
}

export default () => {
	describe('registry image deletion', () => {
		const ctx: AnyObject = {};

		before(async function () {
			const fx = await fixtures.load('26-registry-image-deletion');
			ctx.fixtures = fx;
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
			await fixtures.clean(ctx.fixtures);
		});

		it('should mark for deletion when an image is deleted', async () => {
			const image = await createImage(ctx.service1.id);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.dbImage.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () => image.registryImage.delete === true,
			});
			await expectSettledTasks([image]);
		});

		it('should mark for deletion when multiple images are deleted', async () => {
			const [imageA, imageB] = await Promise.all([
				createImage(ctx.service1.id),
				createImage(ctx.service1.id),
			]);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				options: {
					$filter: {
						id: { $in: [imageA.dbImage.id, imageB.dbImage.id] },
					},
				},
			});

			await waitFor({
				delayMs: 500,
				checkFn: () =>
					imageA.registryImage.delete === true &&
					imageB.registryImage.delete === true,
			});
			await expectSettledTasks([imageA, imageB]);
		});

		it('should eventually mark for deletion when rate limited', async () => {
			const consoleSpy = sinon.spy(console, 'warn');
			registryMock.setNextDeleteResponseCode(429);
			const image = await createImage(ctx.service1.id);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.dbImage.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () => image.registryImage.delete === true,
			});
			await expectSettledTasks([image]);
			sinon.assert.calledWithMatch(consoleSpy, sinon.match(/Received 429 for/));
			consoleSpy.restore();
		});

		it('should retry on registry API errors', async () => {
			// We have the mock return 500 on the next delete request
			// which will cause the first task attempt to fail, but
			// the second attempt should succeed.
			registryMock.setNextDeleteResponseCode(500);
			const consoleSpy = sinon.spy(console, 'error');
			const image = await createImage(ctx.service1.id);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.dbImage.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () => image.registryImage.delete === true,
			});
			await expectSettledTasks([image]);
			sinon.assert.calledWithMatch(
				consoleSpy,
				sinon.match(
					new RegExp(
						`Failed to mark ${stripRegistryHost(image.dbImage.is_stored_at__image_location)}/${image.dbImage.content_hash} for deletion: \\[500\\]`,
					),
				),
			);
			consoleSpy.restore();
		});

		it('should not fail when image does not exist in registry', async () => {
			const image = await createImage(ctx.service1.id);
			registryMock.deleteImage(image.registryImage);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.dbImage.id,
			});

			await expectSettledTasks([image]);
		});

		it('should delete multi-stage cache images when an image is deleted', async () => {
			const image = await createImage(ctx.service1.id, {
				stages: 2,
			});
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.dbImage.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () =>
					image.registryImage.delete === true &&
					image.cacheImages.every((ci) => ci.delete === true),
			});
			await expectSettledTasks([image]);
		});

		it('should create a follow-up task when deletion takes too long', async () => {
			const originalMaxTime =
				config.ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS;
			config.TEST_MOCK_ONLY.ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS = 50;

			try {
				const images = await Promise.all(
					Array.from({ length: 25 }, () => createImage(ctx.service1.id)),
				);

				const consoleSpy = sinon.spy(console, 'info');
				await api.resin.delete({
					resource: 'image',
					passthrough: { req: permissions.root },
					options: {
						$filter: {
							id: { $in: images.map((i) => i.dbImage.id) },
						},
					},
				});
				await waitFor({
					delayMs: 500,
					checkFn: () => images.every((i) => i.registryImage.delete === true),
				});

				sinon.assert.calledWithMatch(
					consoleSpy,
					sinon.match(
						'[delete-registry-images-task] Task took too long. Created a new task for the remaining images',
					),
				);

				consoleSpy.restore();
			} finally {
				config.TEST_MOCK_ONLY.ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS =
					originalMaxTime;
				await resetLatestTaskIds('delete_registry_images');
			}
		});

		it('should mark for deletion when images are deleted via a cascade', async () => {
			const { images } = await createRelease(ctx.app1.id, ctx.service1.id);
			const expectedImages = images.map((image) => [
				image.dbImage.is_stored_at__image_location,
				image.dbImage.content_hash!,
			]);

			await api.resin.delete({
				resource: 'application',
				passthrough: { req: permissions.root },
				id: ctx.app1.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () =>
					expectedImages.every(
						([location, hash]) =>
							registryMock.getImage({
								is_stored_at__image_location: location,
								content_hash: hash,
							})?.delete === true,
					),
			});
			await expectSettledTasks(images);
		});

		it('should not mark unrelated images for deletion', () => {
			expect(ctx.notDeletedImage.registryImage.delete).to.be.false;
		});
	});
};
