import { permissions, sbvrUtils, tasks } from '@balena/pinejs';
import _ from 'lodash';
import { ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE } from '../../../lib/config.js';
import { deleteImage } from '../../../features/registry/registry.js';

const { api } = sbvrUtils;

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
			const images = (options.params as DeleteRegistryImagesTaskParams).images;
			if (images == null || images.length === 0) {
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
								: chunk.map(([repo, hash]) => ({
										is_stored_at__image_location: repo,
										content_hash: hash,
									})),
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
					await deleteImage(`task:${handlerName}`, repo, hash);
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
