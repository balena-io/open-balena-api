import { hooks, sbvrUtils, permissions } from '@balena/pinejs';
import {
	ASYNC_TASK_ATTEMPT_LIMIT,
	DEPENDENCY_TRACK_API_KEY,
	DEPENDENCY_TRACK_URL,
} from '../../../lib/config.js';
import type { SubmitSBOMTaskParams } from '../tasks/process-sbom-vex.js';

const dispatchSbomTask: hooks.Hooks<'resin'>['POSTRUN'] = async (args) => {
	if (DEPENDENCY_TRACK_URL == null || DEPENDENCY_TRACK_API_KEY == null) {
		return;
	}

	const { api } = args;
	const releaseAssetIds = await sbvrUtils.getAffectedIds(args);
	if (releaseAssetIds.length === 0) {
		return;
	}

	const assets = await api.get({
		resource: 'release_asset',
		options: {
			$select: ['id', 'asset'],
			$filter: { id: { $in: releaseAssetIds } },
		},
	});

	await Promise.all(
		assets
			.filter(
				(releaseAsset) =>
					releaseAsset.asset != null &&
					(releaseAsset.asset.filename.endsWith('bom.json') ||
						releaseAsset.asset.filename.endsWith('vex.json')),
			)
			.map((releaseAsset) =>
				sbvrUtils.api.tasks.post({
					resource: 'task',
					passthrough: { req: permissions.root, tx: args.tx },
					body: {
						is_executed_by__handler: 'submit_sbom_to_dependency_track',
						is_executed_with__parameter_set: {
							releaseAssetId: releaseAsset.id,
						} satisfies SubmitSBOMTaskParams,
						attempt_limit: ASYNC_TASK_ATTEMPT_LIMIT,
					},
				}),
			),
	);
};

hooks.addPureHook('POST', 'resin', 'release_asset', {
	POSTRUN: dispatchSbomTask,
});
hooks.addPureHook('PATCH', 'resin', 'release_asset', {
	POSTRUN: async (args) => {
		if (!('asset' in args.request.values)) {
			return;
		}
		return dispatchSbomTask(args);
	},
});
