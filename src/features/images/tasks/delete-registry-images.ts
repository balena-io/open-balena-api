import { permissions, sbvrUtils, tasks } from '@balena/pinejs';
import type { FromSchema } from 'json-schema-to-ts';
import {
	deleteImage,
	deleteMultiStageCacheImages,
} from '../../../features/registry/registry.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS,
} from '../../../lib/config.js';

const schema = {
	type: 'object',
	properties: {
		images: {
			type: 'array',
			items: {
				type: 'array',
				items: [
					// image.is_stored_at__image_location
					{ type: 'string' },
					// image.content_hash
					{ type: 'string' },
					// number of stages in image.dockerfile
					{ type: 'number', minimum: 0 },
				],
				additionalItems: false,
				maxItems: 3,
				minItems: 3,
			},
		},
	},
	required: ['images'],
	additionalProperties: false,
} as const;

const { api } = sbvrUtils;

export type DeleteRegistryImagesTaskParams = FromSchema<typeof schema>;

const handlerName = 'delete_registry_images';
const logHeader = `${handlerName.replace(/_/g, '-')}-task`;
tasks.addTaskHandler(
	handlerName,
	async (options) => {
		try {
			const totalImagesDeleted = await deleteRegistryImages(options.params);
			console.info(
				`[${logHeader}] Deleted ${totalImagesDeleted} registry images`,
			);
			return {
				status: 'succeeded',
			};
		} catch (e) {
			console.error(`[${logHeader}] Error deleting registry images: ${e}`);
			return {
				error: `${e}`,
				status: 'failed',
			};
		}
	},
	schema,
);

const deleteRegistryImages = async ({
	images,
}: DeleteRegistryImagesTaskParams) => {
	const startTime = Date.now();

	// Avoid deleting any blobs that are still referenced by other images
	// This shouldn't normally be necessary as is_stored_at__image_location
	// should be enforced as unique at the database level, but just in case
	const stillReferenced = await api.resin.get({
		resource: 'image',
		passthrough: { req: permissions.rootRead },
		options: {
			$select: ['is_stored_at__image_location', 'content_hash'],
			$filter:
				images.length === 1
					? {
							is_stored_at__image_location: images[0][0],
							content_hash: images[0][1],
						}
					: images.map(([location, hash]) => ({
							is_stored_at__image_location: location,
							content_hash: hash,
						})),
		},
	});

	// Define what images are actually safe to delete
	const safeToDelete = images.filter(
		([location, hash]) =>
			!stillReferenced.some(
				(image) =>
					image.is_stored_at__image_location === location &&
					image.content_hash === hash,
			),
	);

	// Mark images and any of their multi-stage cache images for deletion
	// Don't let the task run for too long, and create a new task with
	// the remaining image data if it does
	let totalImagesDeleted = 0;
	for (let i = 0; i < safeToDelete.length; i++) {
		const [location, hash, stages] = safeToDelete[i];
		if (
			Date.now() - startTime >
			ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS
		) {
			await api.tasks.post({
				resource: 'task',
				passthrough: { req: permissions.root },
				body: {
					is_executed_by__handler: 'delete_registry_images',
					is_executed_with__parameter_set: {
						images: safeToDelete.slice(i),
					} satisfies DeleteRegistryImagesTaskParams,
					attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
				},
			});

			console.info(
				`[${logHeader}] Task took too long. Created a new task for the remaining images`,
			);
			return totalImagesDeleted;
		}
		// Remove leading domain from location
		const repo = location.replace(/^[^/]+\//, '');
		if (repo === '' || hash === '') {
			console.warn(
				`[${logHeader}] Skipping deletion of image with empty repo or hash: ${repo}/${hash}`,
			);
			continue;
		}
		await deleteImage(`task:${handlerName}`, repo, hash);
		if (stages > 0) {
			await deleteMultiStageCacheImages(`task:${handlerName}`, repo, stages);
		}
		totalImagesDeleted++;
	}
	return totalImagesDeleted;
};
