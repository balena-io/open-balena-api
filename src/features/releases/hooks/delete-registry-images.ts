import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import _ from 'lodash';
import type { DeleteRegistryImagesTaskParams } from '../tasks/delete-registry-images.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
	ASYNC_TASKS_ENABLED,
} from '../../../lib/config.js';

interface DeleteRequestCustomObject {
	imagesToCleanup?: number[];
}

if (ASYNC_TASKS_ENABLED) {
	hooks.addPureHook('DELETE', 'resin', 'release', {
		PRERUN: async (args) => {
			const { api, request } = args;
			const affectedIds = await sbvrUtils.getAffectedIds(args);
			if (affectedIds.length === 0) {
				return;
			}

			// Find the list of now orphaned images that we should mark for
			// deletion in the registry. We need to do it here in the PRERUN
			// as doing it in the POSTRUN is too late.
			const imagesToCleanup = (
				await api.get({
					resource: 'image',
					options: {
						$select: ['id'],
						$filter: {
							content_hash: { $ne: null },
							release_image: {
								$any: {
									$alias: 'ri',
									$expr: {
										ri: {
											is_part_of__release: { $in: affectedIds },
										},
									},
								},
							},
						},
					},
				})
			).map((image) => image.id);
			if (imagesToCleanup.length > 0) {
				(request.custom as DeleteRequestCustomObject).imagesToCleanup =
					imagesToCleanup;
			}
		},
		POSTRUN: async ({ request, tx }) => {
			const { imagesToCleanup } = request.custom as DeleteRequestCustomObject;
			if (imagesToCleanup == null || imagesToCleanup?.length === 0) {
				return;
			}
			if (imagesToCleanup.length > 0) {
				await Promise.all(
					_.chunk(
						imagesToCleanup,
						ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
					).map(async (imageBatch) => {
						return await sbvrUtils.api.tasks.post({
							resource: 'task',
							passthrough: { req: permissions.root, tx },
							body: {
								is_executed_by__handler: 'delete_registry_images',
								is_executed_with__parameter_set: {
									images: imageBatch,
								} satisfies DeleteRegistryImagesTaskParams,
								attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
							},
						});
					}),
				);
			}
		},
	});
}
