import { permissions, sbvrUtils, tasks } from '@balena/pinejs';
import type { FromSchema } from 'json-schema-to-ts';
import PQueue from 'p-queue';
import {
	deleteImage,
	generateDeleteToken,
	getManifestDigest,
	listRepoTags,
	s3Client,
} from '../../../features/registry/registry.js';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_CONCURRENCY,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS,
} from '../../../lib/config.js';

// Shared across invocations as a global cap on concurrent registry deletions.
// If a task times out waiting for a slot, it just re-enqueues the remaining work.
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
				await deleteRegistryImages(options.params);
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

// Fallback used when the registry's S3 client isn't available.
async function deleteRepoViaApi(
	repo: string,
	signal: AbortSignal,
): Promise<boolean> {
	signal.throwIfAborted();
	const token = generateDeleteToken(subject, repo);
	const tags = await listRepoTags(token, repo);
	if (tags == null) {
		return false;
	}

	// Several tags can point at the same manifest, so resolve them all
	// before deleting to avoid repeated deletes of the same digest.
	const digests = new Set<string>();
	for (const tag of tags) {
		signal.throwIfAborted();
		const digest = await getManifestDigest(token, repo, tag);
		if (digest != null) {
			digests.add(digest);
		}
	}

	for (const digest of digests) {
		signal.throwIfAborted();
		await deleteImage(token, repo, digest);
	}
	return true;
}

// Delete all manifests within a given registry repository (and its multi-stage
// build cache repositories) by removing the entire `_manifests` directory.
// We delete the directory directly rather than marking each manifest for
// deletion via the registry API, as the API leaves behind legacy signature
// links that keep the `_manifests` directory (and thus the repository in the
// catalog list) alive. The registry API is only used as a fallback for when
// registry's S3 client isn't available.
async function deleteRepo(repo: string, signal: AbortSignal): Promise<void> {
	if (s3Client != null) {
		const cacheRepos = await s3Client.listCacheRepos(repo);
		for (const target of [...cacheRepos, repo]) {
			await s3Client.deleteRepoManifests(target, signal);
		}
		return;
	}

	// Without the S3 client we can't list the multi-stage build cache
	// repositories, so try until one is missing.
	let stage = 0;
	while (true) {
		const deleted = await deleteRepoViaApi(`${repo}-${stage}`, signal);
		if (!deleted) {
			break;
		}
		stage++;
	}
	await deleteRepoViaApi(repo, signal);
}

const deleteRegistryImages = async ({
	images,
}: DeleteRegistryImagesTaskParams) => {
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
	const timeoutAbortSignal = AbortSignal.timeout(
		ASYNC_TASK_DELETE_REGISTRY_IMAGES_MAX_TIME_MS,
	);
	const signal = AbortSignal.any([timeoutAbortSignal, errorController.signal]);
	const initialCount = remaining.size;
	try {
		await queue.addAll(
			Array.from(remaining, (location) => async () => {
				const repo = location.replace(/^[^/]+\//, '');
				if (repo === '') {
					console.warn(
						`[${logHeader}] Skipping deletion of image with empty repo: ${location}`,
					);
				} else {
					await deleteRepo(repo, signal);
				}
				remaining.delete(location);
			}),
			{ signal },
		);
	} catch (err) {
		// In all cases other than a timeout error, we fail the task
		if (!timeoutAbortSignal.aborted || timeoutAbortSignal.reason !== err) {
			errorController.abort(err);
			throw err;
		}
	}

	console.info(
		`[${logHeader}] Processed ${initialCount - remaining.size}/${initialCount} images`,
	);

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
};
