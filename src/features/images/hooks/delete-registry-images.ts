import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import _ from 'lodash';
import type { DeleteRegistryImagesTaskParams } from '../tasks/delete-registry-images.js';
import { s3Client } from '../../registry/registry.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_OFFSET_MS,
} from '../../../lib/config.js';

interface DeleteRequestCustomObject {
	imagesToCleanup?: DeleteRegistryImagesTaskParams['images'];
}

if (ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED) {
	if (s3Client == null) {
		throw new Error(
			'Cannot enable this hook when registry S3 client is not initialized',
		);
	}
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
					$select: ['is_stored_at__image_location'],
					$filter: {
						id: { $in: affectedIds },
					},
				},
			});
			if (images.length > 0) {
				(request.custom as DeleteRequestCustomObject).imagesToCleanup =
					images.map((image) => ({
						location: image.is_stored_at__image_location,
					}));
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
				chunks.map((images) =>
					sbvrUtils.api.tasks.post({
						resource: 'task',
						passthrough: { req: permissions.root, tx },
						body: {
							is_executed_by__handler: 'delete_registry_images',
							is_executed_with__parameter_set: {
								images,
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
