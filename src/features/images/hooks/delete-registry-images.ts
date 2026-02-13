import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import _ from 'lodash';
import type { DeleteRegistryImagesTaskParams } from '../tasks/delete-registry-images.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_OFFSET_MS,
	ASYNC_TASKS_ENABLED,
} from '../../../lib/config.js';

interface DeleteRequestCustomObject {
	imagesToCleanup?: DeleteRegistryImagesTaskParams['images'];
}

if (ASYNC_TASKS_ENABLED && ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED) {
	hooks.addPureHook('DELETE', 'resin', 'image', {
		PRERUN: async (args) => {
			const { api, request } = args;
			const affectedIds = await sbvrUtils.getAffectedIds(args);
			if (affectedIds.length === 0) {
				return;
			}

			// Get information required to mark the image for deletion on
			// the registry before the record is deleted from our database.
			const images = await api.get({
				resource: 'image',
				options: {
					$select: ['is_stored_at__image_location', 'content_hash'],
					$filter: {
						id: { $in: affectedIds },
						content_hash: { $ne: null },
						status: 'success',
					},
				},
			});
			if (images.length > 0) {
				(request.custom as DeleteRequestCustomObject).imagesToCleanup =
					images.map((image) => [
						image.is_stored_at__image_location.replace(/^[^/]+\//, ''),
						image.content_hash!,
					]);
			}
		},
		POSTRUN: async ({ request, tx }) => {
			const { imagesToCleanup } = request.custom as DeleteRequestCustomObject;
			if (imagesToCleanup == null || imagesToCleanup.length === 0) {
				return;
			}

			const chunks = _.chunk(
				imagesToCleanup,
				ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
			);
			await Promise.all(
				chunks.map((chunk) =>
					sbvrUtils.api.tasks.post({
						resource: 'task',
						passthrough: { req: permissions.root, tx },
						body: {
							is_executed_by__handler: 'delete_registry_images',
							is_executed_with__parameter_set: {
								images: chunk,
							} satisfies DeleteRegistryImagesTaskParams,
							is_scheduled_to_execute_on__time: new Date(
								Date.now() + ASYNC_TASK_DELETE_REGISTRY_IMAGES_OFFSET_MS,
							),
							attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
						},
					}),
				),
			);
		},
	});
}
