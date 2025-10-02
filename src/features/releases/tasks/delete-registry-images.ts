import { tasks, sbvrUtils, permissions } from '@balena/pinejs';
import { generateToken } from '../../registry/registry.js';
import { REGISTRY2_HOST } from '../../../lib/config.js';
import { requestAsync } from '../../../infra/request-promise/index.js';
import { setTimeout } from 'node:timers/promises';

// For registry API requests
const DELAY = 200;
const RATE_LIMIT_DELAY = 1000;
const RATE_LIMIT_RETRIES = 5;

const schema = {
	type: 'object',
	properties: {
		images: {
			type: 'array',
			items: { type: 'number' },
		},
	},
	required: ['images'],
};

const { api } = sbvrUtils;

export type DeleteRegistryImagesTaskParams = {
	images: number[];
};

const name = 'delete_registry_images';
const logHeader = name.replace(/_/g, '-');
tasks.addTaskHandler(
	name,
	async (options) => {
		try {
			const imageIds =
				(options.params as DeleteRegistryImagesTaskParams).images ?? [];

			// Return early if no images were provided
			if (imageIds.length === 0) {
				return {
					status: 'succeeded',
				};
			}

			// Get details on images and mark for deletion
			const images = await getImages(imageIds);
			for (const [repo, hashes] of Object.entries(images)) {
				if (hashes.length === 0) {
					continue;
				}
				await markForDeletion(repo, hashes);
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

// Get images from our database that should be marked for deletion in the registry
async function getImages(imageIds: number[]) {
	const records = await api.resin.get({
		resource: 'image',
		// TODO: Try removing this passthrough
		passthrough: { req: permissions.rootRead },
		options: {
			$select: ['id', 'is_stored_at__image_location', 'content_hash'],
			$filter: {
				id: { $in: imageIds },
				content_hash: { $ne: null },
			},
		},
	});
	console.info(
		`[${logHeader}] Found ${records.length} images to delete from registry`,
	);

	// Group image hashes by repository name
	const images: { [repository: string]: string[] } = {};
	for (const record of records) {
		if (record.content_hash == null) {
			continue;
		}
		const repo = record.is_stored_at__image_location.replace(
			REGISTRY2_HOST,
			'',
		);
		images[repo] ??= [];
		images[repo].push(record.content_hash);
	}
	return images;
}

// Make an API call to the registry service to mark images for deletion on next garbage collection
async function markForDeletion(repo: string, hashes: string[]) {
	// Generate an admin-level token with delete permission
	const token = generateToken('admin', REGISTRY2_HOST, [
		{
			name: repo,
			type: 'repository',
			actions: ['delete'],
		},
	]);

	// Need to make requests one image at a time, no batch endpoint available
	for (const hash of hashes) {
		let retries = 0;
		let success = false;
		while (retries < RATE_LIMIT_RETRIES && !success) {
			try {
				const [{ statusCode, headers }] = await requestAsync({
					url: `https://${REGISTRY2_HOST}/v2/${repo}/manifests/${hash}`,
					headers: { Authorization: `Bearer ${token}` },
					method: 'DELETE',
				});
				let delay = DELAY;
				if (statusCode === 202) {
					success = true;
				} else if (statusCode === 429) {
					retries++;
					if (retries >= RATE_LIMIT_RETRIES) {
						throw new Error('ran out of rate-limit retries');
					}

					// Delay with exponential backoff
					delay = RATE_LIMIT_DELAY * Math.pow(2, retries - 1);

					// Use the retry-after header value if available
					const retryAfterHeader = headers?.['retry-after'];
					if (retryAfterHeader) {
						const retryAfterSeconds = parseInt(retryAfterHeader, 10);
						if (!isNaN(retryAfterSeconds)) {
							delay = retryAfterSeconds * 1000;
						} else {
							const retryAfterDate = new Date(retryAfterHeader);
							const waitMillis = retryAfterDate.getTime() - Date.now();
							if (waitMillis > 0) {
								delay = waitMillis;
							}
						}
					}

					if (retries < RATE_LIMIT_RETRIES) {
						console.warn(
							`[${logHeader}] Received 429 for ${repo}/${hash}. Retrying in ${delay}ms... (attempt ${retries}/${RATE_LIMIT_RETRIES})`,
						);
					}
				}
				await setTimeout(delay);
			} catch (e: any) {
				console.error(
					`[${logHeader}] Failed to mark image '${repo}/${hash}' for deletion: ${e}`,
				);
				break;
			}
		}
	}
}
