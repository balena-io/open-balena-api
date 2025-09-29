import { permissions, sbvrUtils, tasks } from '@balena/pinejs';
import type { FromSchema } from 'json-schema-to-ts';
import {
	deleteImage,
	generateDeleteToken,
	s3Client,
} from '../../../features/registry/registry.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS,
} from '../../../lib/config.js';

const schema = {
	type: 'object',
	properties: {
		images: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					location: {
						type: 'string',
					},
				},
				required: ['location'],
				additionalProperties: false,
			},
		},
	},
	required: ['images'],
	additionalProperties: false,
} as const;

const { api } = sbvrUtils;

export type DeleteRegistryImagesTaskParams = FromSchema<typeof schema>;

const handlerName = 'delete_registry_images';
const logHeader = 'delete_registry_images_task';
if (ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED) {
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
				console.error(`[${logHeader}] Error deleting registry images:`, e);
				return {
					error: `${e}`,
					status: 'failed',
				};
			}
		},
		schema,
	);
}

const subject = `task:${handlerName}`;
const deleteRegistryImages = async ({
	images,
}: DeleteRegistryImagesTaskParams) => {
	if (s3Client == null) {
		throw new Error('Registry S3 client not initialized.');
	}
	const startTime = Date.now();

	// Avoid deleting any blobs that are still referenced by other images
	// This shouldn't normally be necessary as is_stored_at__image_location
	// should be enforced as unique at the database level, but just in case
	const stillReferenced = await api.resin.get({
		resource: 'image',
		passthrough: { req: permissions.rootRead },
		options: {
			$select: ['is_stored_at__image_location'],
			$filter: {
				is_stored_at__image_location: {
					$in: images.map((image) => image.location),
				},
			},
		},
	});

	// Define what images are actually safe to delete
	const stillReferencedLocations = new Set(
		stillReferenced.map((ref) => ref.is_stored_at__image_location),
	);
	const safeToDelete = images.filter(
		(image) => !stillReferencedLocations.has(image.location),
	);

	// Mark images and any of their multi-stage cache images for deletion
	// Don't let the task run for too long, and create a new task with
	// the remaining image data if it does
	let totalImagesDeleted = 0;
	for (let i = 0; i < safeToDelete.length; i++) {
		const { location } = safeToDelete[i];
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
		if (repo === '') {
			console.warn(
				`[${logHeader}] Skipping deletion of image with empty repo: ${location}`,
			);
			continue;
		}

		// Delete cache images first so they aren't orphaned if the task
		// fails after deleting the main image.
		const cacheRepos = await s3Client.listCacheRepos(repo);
		for (const cacheRepo of cacheRepos) {
			const cacheDigests = await s3Client.listRepoDigests(cacheRepo);
			if (cacheDigests.length === 0) {
				continue;
			}
			const cacheToken = generateDeleteToken(subject, cacheRepo);
			// Delete sequentially to avoid overloading the registry/s3
			for (const digest of cacheDigests) {
				await deleteImage(cacheToken, cacheRepo, digest);
			}
		}

		// Delete main image last
		const digests = await s3Client.listRepoDigests(repo);
		if (digests.length > 0) {
			const token = generateDeleteToken(subject, repo);
			// Delete sequentially to avoid overloading the registry/s3
			for (const digest of digests) {
				await deleteImage(token, repo, digest);
			}
		}
		totalImagesDeleted++;
	}
	return totalImagesDeleted;
};
