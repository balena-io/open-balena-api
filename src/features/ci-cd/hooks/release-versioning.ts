import { sbvrUtils, hooks, errors } from '@balena/pinejs';

const { BadRequestError } = errors;

hooks.addPureHook('PATCH', 'resin', 'release', {
	PRERUN: async (args) => {
		const { api, request } = args;
		if (request.values.release_type === 'draft') {
			const releaseIds = await sbvrUtils.getAffectedIds(args);
			if (releaseIds.length === 0) {
				return;
			}
			const finalizedReleases = await api.get({
				resource: 'release',
				options: {
					$top: 1,
					$select: 'id',
					$filter: {
						id: { $in: releaseIds },
						release_type: 'final',
					},
				},
			});
			if (finalizedReleases.length > 0) {
				throw new BadRequestError(
					'Finalized releases cannot be converted to draft.',
				);
			}
		}
	},
});
