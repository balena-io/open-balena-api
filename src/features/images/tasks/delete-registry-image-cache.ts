import { tasks } from '@balena/pinejs';
import { ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED } from '../../../lib/config.js';
import { deleteRegistryImages, schema } from './delete-registry-images.js';

const handlerName = 'delete_registry_image_cache';
const logHeader = 'delete_registry_image_cache_task';
if (ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED) {
	tasks.addTaskHandler(
		handlerName,
		async (options) => {
			try {
				await deleteRegistryImages(handlerName, options.params.images, {
					deleteImage: false,
					deleteCache: true,
				});
				return {
					status: 'succeeded',
				};
			} catch (e) {
				console.error(`[${logHeader}] Error deleting registry image cache:`, e);
				return {
					error: `${e}`,
					status: 'failed',
				};
			}
		},
		schema,
	);
}
