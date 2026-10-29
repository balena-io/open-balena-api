import { sbvrUtils, hooks, permissions } from '@balena/pinejs';
import _ from 'lodash';

interface DeleteRequestCustomObject {
	candidateImageIds?: number[];
}

// The images being deleted in each transaction, so that the cascade delete of
// their image__is_part_of__release links does not delete them again.
const imagesBeingDeleted = new WeakMap<Tx, Set<number>>();

hooks.addPureHook('DELETE', 'resin', 'image', {
	PRERUN: async (args) => {
		// getAffectedIds is shared with the cascade delete hook, so this runs
		// before the cascade deletes the image__is_part_of__release links.
		const affectedIds = await sbvrUtils.getAffectedIds(args);
		if (affectedIds.length === 0) {
			return;
		}
		const imageIds = imagesBeingDeleted.get(args.tx) ?? new Set<number>();
		for (const id of affectedIds) {
			imageIds.add(id);
		}
		imagesBeingDeleted.set(args.tx, imageIds);
	},
});

// Images can be shared, so the release cascade cannot delete them unconditionally.
// A release PRERUN hook would race that cascade because PRERUN hooks run
// concurrently. Hook the link deletion to capture image IDs in PRERUN and check
// for orphans in POSTRUN.
hooks.addPureHook('DELETE', 'resin', 'image__is_part_of__release', {
	PRERUN: async (args) => {
		const { api, request, tx } = args;
		const affectedIds = await sbvrUtils.getAffectedIds(args);
		if (affectedIds.length === 0) {
			return;
		}

		const releaseImages = await api.get({
			resource: 'image__is_part_of__release',
			options: {
				$select: 'image',
				$filter: {
					id: { $in: affectedIds },
				},
			},
		});
		const imagesBeingDeletedInTx = imagesBeingDeleted.get(tx);
		const candidateImageIds = _.uniq(
			releaseImages.map((ri) => ri.image.__id),
		).filter((id) => !imagesBeingDeletedInTx?.has(id));
		if (candidateImageIds.length > 0) {
			(request.custom as DeleteRequestCustomObject).candidateImageIds =
				candidateImageIds;
		}
	},
	POSTRUN: async ({ api, request }) => {
		const { candidateImageIds } = request.custom as DeleteRequestCustomObject;
		if (candidateImageIds == null || candidateImageIds.length === 0) {
			return;
		}

		// Root is required since read access to an image is granted through
		// its image__is_part_of__release links, which are now deleted.
		await api.delete({
			resource: 'image',
			passthrough: { req: permissions.root },
			options: {
				$filter: {
					id: { $in: candidateImageIds },
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
