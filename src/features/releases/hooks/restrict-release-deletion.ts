import { sbvrUtils, hooks, errors } from '@balena/pinejs';
import type {
	Application,
	Device,
	PickExpanded,
} from '../../../balena-model.js';
const { BadRequestError } = errors;

hooks.addPureHook('DELETE', 'resin', 'release', {
	PRERUN: async (args) => {
		const { api } = args;
		const affectedIds = await sbvrUtils.getAffectedIds(args);
		if (affectedIds.length === 0) {
			return;
		}

		const [applicationPinnedToRelease] = (await api.get({
			resource: 'application',
			options: {
				$top: 1,
				$select: 'is_of__class',
				$expand: { should_be_running__release: { $select: 'raw_version' } },
				$filter: {
					should_be_running__release: {
						$any: {
							$alias: 'sbrr',
							$expr: {
								sbrr: {
									id: { $in: affectedIds },
								},
							},
						},
					},
				},
			},
		})) as Array<
			PickExpanded<Application, 'is_of__class' | 'should_be_running__release'>
		>;

		if (applicationPinnedToRelease != null) {
			throw new BadRequestError(
				`Unable to delete release ${applicationPinnedToRelease.should_be_running__release[0]?.raw_version} because it is the ${applicationPinnedToRelease.is_of__class}'s target release.`,
			);
		}

		const [devicesPinnedToRelease] = (await api.get({
			resource: 'device',
			options: {
				$top: 1,
				$select: 'id',
				$filter: {
					should_be_running__release: {
						$any: {
							$alias: 'sbrr',
							$expr: {
								sbrr: {
									id: { $in: affectedIds },
								},
							},
						},
					},
				},
			},
		})) as Array<PickExpanded<Device, 'id'>>;

		if (devicesPinnedToRelease != null) {
			throw new BadRequestError(
				'Unable to delete a release because device(s) are pinned to it.',
			);
		}
	},
});
