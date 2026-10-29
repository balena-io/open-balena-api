import { sbvrUtils, hooks, permissions } from '@balena/pinejs';

interface DeleteRequestCustomObject {
	imageIds?: number[];
}

hooks.addPureHook('DELETE', 'resin', 'release', {
	PRERUN: async (args) => {
		const { api, request } = args;
		const releaseIds = await sbvrUtils.getAffectedIds(args);
		if (releaseIds.length === 0) {
			return;
		}

		const imageIds = (
			await api.get({
				resource: 'image',
				options: {
					$select: 'id',
					$filter: {
						image__is_part_of__release: {
							$any: {
								$alias: 'ipr',
								$expr: { ipr: { is_part_of__release: { $in: releaseIds } } },
							},
						},
					},
				},
			})
		).map((image) => image.id);
		if (imageIds.length > 0) {
			(request.custom as DeleteRequestCustomObject).imageIds = imageIds;
		}

		// Delete the release links here instead of via the generic cascade hook.
		// Hooks of the same resource run in parallel, so the cascade could delete
		// the links before we read the image ids above.
		await api.delete({
			resource: 'image__is_part_of__release',
			options: {
				$filter: {
					is_part_of__release: { $in: releaseIds },
				},
			},
		});
	},
	POSTRUN: async ({ api, request }) => {
		const { imageIds } = request.custom as DeleteRequestCustomObject;
		if (imageIds == null || imageIds.length === 0) {
			return;
		}

		await api.delete({
			resource: 'image',
			passthrough: { req: permissions.root },
			options: {
				$filter: {
					id: { $in: imageIds },
					$not: {
						image__is_part_of__release: {
							$any: {
								$alias: 'ipr',
								$expr: { ipr: { id: { $ne: null } } },
							},
						},
					},
				},
			},
		});
	},
});
