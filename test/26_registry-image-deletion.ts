import * as fixtures from './test-lib/fixtures.js';
import * as registryMock from './test-lib/registry-mock.js';
import { waitFor } from './test-lib/common.js';
import * as config from '../src/lib/config.js';
import { randomUUID } from 'node:crypto';
import { permissions, sbvrUtils } from '@balena/pinejs';
import { expectNewSettledTasks } from './test-lib/api-helpers.js';
import { setTimeout } from 'node:timers/promises';
import sinon from 'sinon';

const { api } = sbvrUtils;

function randomHash() {
	return randomUUID().replace(/-/g, '').toLowerCase();
}

async function createImage(serviceId: number, releaseId?: number) {
	const now = new Date();
	const image = await api.resin.post({
		resource: 'image',
		passthrough: { req: permissions.root },
		body: {
			content_hash: `sha256:${randomHash()}`,
			start_timestamp: now,
			is_a_build_of__service: serviceId,
			status: 'success',
			push_timestamp: now,
		},
	});

	if (releaseId != null) {
		await api.resin.post({
			resource: 'image__is_part_of__release',
			passthrough: { req: permissions.root },
			body: {
				image: image.id,
				is_part_of__release: releaseId,
			},
		});
	}

	return {
		image,
		registryImage: registryMock.addImage(image),
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
		createImage(serviceId, release.id),
		createImage(serviceId, release.id),
	]);

	return {
		release,
		images: [image1.image, image2.image],
	};
}

function stripRegistryHost(location: string) {
	return location.replace(`${config.REGISTRY2_HOST}/`, '');
}

const offsetMs = 200;
export default () => {
	describe('registry image deletion', () => {
		const ctx: AnyObject = {};

		before(async function () {
			const fx = await fixtures.load('26-registry-image-deletion');
			ctx.fixtures = fx;
			ctx.app1 = fx.applications.app1;
			ctx.service1 = fx.services.service1;
			config.TEST_MOCK_ONLY.ASYNC_TASK_DELETE_REGISTRY_IMAGES_OFFSET_MS =
				offsetMs;
		});

		after(async () => {
			delete ctx.fixtures.applications['app1'];
			await fixtures.clean(ctx.fixtures);
		});

		it('should mark for deletion when images are deleted directly', async () => {
			const { image, registryImage } = await createImage(ctx.service1.id);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () => registryImage.delete === true,
			});

			await expectNewSettledTasks('delete_registry_images', [
				{
					status: 'succeeded',
					is_executed_with__parameter_set: {
						images: [
							[
								stripRegistryHost(image.is_stored_at__image_location),
								image.content_hash!,
							],
						],
					},
				},
			]);
		});

		it('should eventually mark for deletion when rate limited', async () => {
			const consoleSpy = sinon.spy(console, 'warn');
			registryMock.setNextDeleteResponseCode(429);
			const { image, registryImage } = await createImage(ctx.service1.id);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.id,
			});

			await waitFor({
				delayMs: 500,
				checkFn: () => registryImage.delete === true,
			});

			await expectNewSettledTasks('delete_registry_images', [
				{
					status: 'succeeded',
					is_executed_with__parameter_set: {
						images: [
							[
								stripRegistryHost(image.is_stored_at__image_location),
								image.content_hash!,
							],
						],
					},
				},
			]);

			sinon.assert.calledWithMatch(consoleSpy, sinon.match(/Received 429 for/));
			consoleSpy.restore();
		});

		it('should retry on registry API errors', async () => {
			// We have the mock return 500 on the next delete request
			// which will cause the first task attempt to fail, but
			// the second attempt should succeed.
			registryMock.setNextDeleteResponseCode(500);
			const consoleSpy = sinon.spy(console, 'error');
			const { image } = await createImage(ctx.service1.id);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.id,
			});

			// Assert task eventually succeeds after giving it time to run
			await setTimeout(offsetMs);
			await expectNewSettledTasks('delete_registry_images', [
				{
					status: 'succeeded',
					is_executed_with__parameter_set: {
						images: [
							[
								stripRegistryHost(image.is_stored_at__image_location),
								image.content_hash!,
							],
						],
					},
				},
			]);

			sinon.assert.calledWithMatch(
				consoleSpy,
				sinon.match(
					new RegExp(
						`Failed to mark ${stripRegistryHost(image.is_stored_at__image_location)}/${image.content_hash} for deletion: \\[500\\]`,
					),
				),
			);
			consoleSpy.restore();
		});

		it('should not fail when image does not exist in registry', async () => {
			const { image, registryImage } = await createImage(ctx.service1.id);
			registryMock.deleteImage(registryImage);
			await api.resin.delete({
				resource: 'image',
				passthrough: { req: permissions.root },
				id: image.id,
			});

			// Assert task succeeded after giving it time to run
			await setTimeout(offsetMs);
			await expectNewSettledTasks('delete_registry_images', [
				{
					status: 'succeeded',
					is_executed_with__parameter_set: {
						images: [
							[
								stripRegistryHost(image.is_stored_at__image_location),
								image.content_hash!,
							],
						],
					},
				},
			]);
		});

		it('should mark for deletion when images are deleted via a cascade', async () => {
			const { images } = await createRelease(ctx.app1.id, ctx.service1.id);
			const expectedImages = images.map((image) => [
				stripRegistryHost(image.is_stored_at__image_location),
				image.content_hash!,
			]);

			// Delete application so we don't have to worry about which release is pinned
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
								is_stored_at__image_location: stripRegistryHost(location),
								content_hash: hash,
							})?.delete === true,
					),
			});
		});
	});
};
