import { permissions, sbvrUtils, tasks } from '@balena/pinejs';
import _ from 'lodash';
import { generateToken } from '../../registry/registry.js';
import {
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
	REGISTRY2_HOST,
} from '../../../lib/config.js';
import { requestAsync } from '../../../infra/request-promise/index.js';
import { setTimeout } from 'node:timers/promises';

const { api } = sbvrUtils;

// For registry API requests
const DELAY = 200;
const RATE_LIMIT_DELAY_BASE = 1000;
const RATE_LIMIT_RETRIES = 5;

const schema = {
	type: 'object',
	properties: {
		images: {
			type: 'array',
			items: {
				type: 'array',
				items: {
					type: 'string',
				},
				maxItems: 2,
				minItems: 2,
			},
		},
	},
	required: ['images'],
	additionalProperties: false,
};

export type DeleteRegistryImagesTaskParams = {
	images: Array<[repo: string, hash: string]>;
};

const handlerName = 'delete_registry_images';
const logHeader = handlerName.replace(/_/g, '-');
tasks.addTaskHandler(
	handlerName,
	async (options) => {
		try {
			const images =
				(options.params as DeleteRegistryImagesTaskParams).images ?? [];
			if (images.length === 0) {
				return {
					status: 'succeeded',
				};
			}

			// Chunk by batch size in case we need to tune after tasks have been created
			for (const chunk of _.chunk(
				images,
				ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
			)) {
				// Avoid deleting any blobs that are still referenced by other images
				// This shouldn't normally be necessary as is_stored_at__image_location
				// should be enforced as unique at the database level, but just in case
				const stillReferenced = await api.resin.get({
					resource: 'image',
					passthrough: { req: permissions.rootRead },
					options: {
						$select: ['id', 'is_stored_at__image_location', 'content_hash'],
						$filter:
							chunk.length === 1
								? {
										is_stored_at__image_location: chunk[0][0],
										content_hash: chunk[0][1],
									}
								: {
										$or: chunk.map(([repo, hash]) => ({
											is_stored_at__image_location: repo,
											content_hash: hash,
										})),
									},
					},
				});
				const safeToDelete = chunk.filter(
					([repo, hash]) =>
						!stillReferenced.some(
							(image) =>
								image.is_stored_at__image_location === repo &&
								image.content_hash === hash,
						),
				);
				for (const [repo, hash] of safeToDelete) {
					if (repo === '' || hash === '') {
						console.warn(
							`[${logHeader}] Skipping deletion of image with empty repo or hash: ${repo}/${hash}`,
						);
						continue;
					}
					await markForDeletion(repo, hash);
				}
			}

			return {
				status: 'succeeded',
			};
		} catch (e) {
			console.error(`[${logHeader}] Error marking images for deletion: ${e}`);
			return {
				error: `${e}`,
				status: 'failed',
			};
		}
	},
	schema,
);

// Make an API call to the registry service to mark images for deletion on next garbage collection
async function markForDeletion(repo: string, hash: string) {
	// Generate an admin-level token with delete permission
	const token = generateToken('admin', REGISTRY2_HOST, [
		{
			name: repo,
			type: 'repository',
			actions: ['delete'],
		},
	]);

	// Need to make requests one image at a time, no batch endpoint available
	for (let retries = 0; retries < RATE_LIMIT_RETRIES; retries++) {
		const [{ statusCode, statusMessage, headers }] = await requestAsync({
			url: `https://${REGISTRY2_HOST}/v2/${repo}/manifests/${hash}`,
			headers: { Authorization: `Bearer ${token}` },
			method: 'DELETE',
		});

		// Return on success or not found
		if (statusCode === 202 || statusCode === 404) {
			await setTimeout(DELAY);
			return;
		} else if (statusCode === 429) {
			// Give up if we've hit the retry limit
			if (retries === RATE_LIMIT_RETRIES - 1) {
				throw new Error(
					`Failed to mark ${repo}/${hash} for deletion: exceeded retry limit due to rate limiting`,
				);
			}

			// Default delay value to exponential backoff
			let delay = RATE_LIMIT_DELAY_BASE * Math.pow(2, retries);

			// Use the retry-after header value if available
			const retryAfterHeader = headers?.['retry-after'];
			if (retryAfterHeader) {
				const headerDelay = parseInt(retryAfterHeader, 10);
				if (!isNaN(headerDelay)) {
					delay = headerDelay * 1000;
				} else {
					const retryDate = Date.parse(retryAfterHeader);
					const waitMillis = retryDate - Date.now();
					if (waitMillis > 0) {
						delay = waitMillis;
					}
				}
			}

			// Apply some jitter for good measure
			delay += Math.random() * 1000;

			console.warn(
				`[${logHeader}] Received 429 for ${repo}/${hash}. Retrying in ${delay}ms...`,
			);
			await setTimeout(delay);
		} else {
			throw new Error(
				`Failed to mark ${repo}/${hash} for deletion: [${statusCode}] ${statusMessage}`,
			);
		}
	}
}
