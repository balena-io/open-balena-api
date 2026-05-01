import { permissions, sbvrUtils, tasks } from '@balena/pinejs';
import type { FromSchema } from 'json-schema-to-ts';
import PQueue from 'p-queue';
import {
	deleteImage,
	generateDeleteToken,
	s3Client,
} from '../../../features/registry/registry.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_CONCURRENCY,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS,
} from '../../../lib/config.js';

const queue = new PQueue({
	concurrency: ASYNC_TASK_DELETE_REGISTRY_IMAGES_CONCURRENCY,
});

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
				const totalManifestsDeleted = await deleteRegistryImages(
					options.params,
				);
				console.info(
					`[${logHeader}] Deleted ${totalManifestsDeleted} registry manifests`,
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

// Delete all manifests within a given registry repository.
const subject = `task:${handlerName}`;
async function deleteRepo(
	s3: NonNullable<typeof s3Client>,
	repo: string,
	signal: AbortSignal,
): Promise<number> {
	let manifestsDeleted = 0;
	const cacheRepos = await s3.listCacheRepos(repo);
	for (const target of [...cacheRepos, repo]) {
		signal.throwIfAborted();
		const digests = await s3.listRepoDigests(target);
		if (digests.length === 0) {
			continue;
		}
		const token = generateDeleteToken(subject, target);
		for (const digest of digests) {
			signal.throwIfAborted();
			await deleteImage(token, target, digest);
			manifestsDeleted++;
		}
	}
	return manifestsDeleted;
}

const deleteRegistryImages = async ({
	images,
}: DeleteRegistryImagesTaskParams) => {
	if (s3Client == null) {
		throw new Error('Registry S3 client not initialized.');
	}

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
	const remaining = new Set(
		images
			.map((image) => image.location)
			.filter((location) => !stillReferencedLocations.has(location)),
	);

	// Mark images and any of their multi-stage cache images for deletion
	// Don't let the task run for too long, and create a new task with
	// the remaining image data if it does
	const errorController = new AbortController();
	const signal = AbortSignal.any([
		AbortSignal.timeout(ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS),
		errorController.signal,
	]);
	let totalManifestsDeleted = 0;
	await Promise.allSettled(
		remaining.values().map((location) =>
			queue.add(
				async () => {
					const repo = location.replace(/^[^/]+\//, '');
					if (repo === '') {
						console.warn(
							`[${logHeader}] Skipping deletion of image with empty repo: ${location}`,
						);
						return;
					}
					try {
						const manifestsDeleted = await deleteRepo(s3Client!, repo, signal);
						totalManifestsDeleted += manifestsDeleted;
						remaining.delete(location);
					} catch (e) {
						errorController.abort(e);
						throw e;
					}
				},
				{ signal },
			),
		),
	);

	// Fail the task if any deletion attempts failed. We don't expect any to fail,
	// so if any of them do, it is likely that the rest attempts will also fail -
	// most likely due to the registry or network having issues.
	if (errorController.signal.aborted) {
		throw errorController.signal.reason;
	}

	// Re-enqueue any remaining images
	if (remaining.size > 0) {
		await api.tasks.post({
			resource: 'task',
			passthrough: { req: permissions.root },
			body: {
				is_executed_by__handler: handlerName,
				is_executed_with__parameter_set: {
					images: Array.from(remaining, (location) => ({ location })),
				} satisfies DeleteRegistryImagesTaskParams,
				attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
			},
		});
		console.info(
			`[${logHeader}] Task took too long. Created a new task for the remaining images`,
		);
	}

	return totalManifestsDeleted;
};
