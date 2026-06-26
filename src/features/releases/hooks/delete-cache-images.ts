import { hooks, permissions, sbvrUtils } from '@balena/pinejs';
import _ from 'lodash';
import {
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
	ASYNC_TASK_DELETE_REGISTRY_IMAGES_OFFSET_MS,
	ASYNC_TASK_ATTEMPT_LIMIT,
} from '../../../lib/config.js';
import type { DeleteRegistryImagesTaskParams } from '../../images/tasks/delete-registry-images.js';

if (ASYNC_TASK_DELETE_REGISTRY_IMAGES_ENABLED) {
	const { api, getAffectedIds } = sbvrUtils;

	// On a new successful release, delete multistage cache images built
	// for previous successful releases. Only the most recent cache is
	// used so there is no reason to keep the old cache around in the registry.
	const deletePreviousCacheHook: hooks.Hooks = {
		POSTRUN: async (args) => {
			if (args.request.values.status !== 'success') {
				return;
			}

			const ids = await getAffectedIds(args);
			if (ids.length === 0) {
				return;
			}

			// Find the images for the most recent successful release of each
			// application that owns one of the releases being updated. Older
			// successful releases had their cache cleaned up when they stopped
			// being the most recent, so we only need the previous one here.
			const locations = (
				await api.resin.get({
					resource: 'application',
					passthrough: { req: permissions.rootRead, tx: args.tx },
					options: {
						$select: 'id',
						$expand: {
							owns__release: {
								$top: 1,
								$skip: 1,
								$select: 'id',
								$orderby: { id: 'desc' },
								$filter: {
									status: 'success',
								},
								$expand: {
									release_image: {
										$select: 'id',
										$expand: {
											image: { $select: 'is_stored_at__image_location' },
										},
									},
								},
							},
						},
						$filter: {
							owns__release: {
								$any: {
									$alias: 'rel',
									$expr: {
										rel: {
											id: { $in: ids },
										},
									},
								},
							},
						},
					},
				})
			).flatMap((app) =>
				app.owns__release.flatMap((release) =>
					release.release_image.flatMap((ri) =>
						ri.image.map((image) => image.is_stored_at__image_location),
					),
				),
			);
			if (locations.length === 0) {
				return;
			}

			// Enqueue task to clean up old cache images in the registry.
			const chunks = _.chunk(
				locations,
				ASYNC_TASK_DELETE_REGISTRY_IMAGES_BATCH_SIZE,
			);
			await Promise.all(
				chunks.map((images) =>
					api.tasks.post({
						resource: 'task',
						passthrough: { req: permissions.root, tx: args.tx },
						body: {
							is_executed_by__handler: 'delete_registry_images',
							is_executed_with__parameter_set: {
								images: images.map((i) => ({
									location: i,
								})),
								onlyDeleteCache: true,
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
	};
	hooks.addPureHook('PATCH', 'resin', 'release', deletePreviousCacheHook);
	hooks.addPureHook('POST', 'resin', 'release', deletePreviousCacheHook);
}
