import * as _ from 'lodash';
import { sbvrUtils } from '@resin/pinejs';
import { addDeleteHookForDependents } from '../../platform';

sbvrUtils.addPureHook('POST', 'resin', 'image__is_part_of__release', {
	POSTRUN: async ({ api, result: platformId }) => {
		// No need to check if image__is_part_of__release was not created
		if (platformId == null) {
			return;
		}

		const releases = (await api.get({
			resource: 'release',
			options: {
				$select: 'id',
				$expand: 'image__is_part_of__release/$count',
				$filter: {
					image__is_part_of__release: {
						$any: {
							$alias: 'ipr',
							$expr: {
								ipr: {
									id: platformId,
									release: {
										$any: {
											$alias: 'r',
											$expr: {
												r: {
													belongs_to__application: {
														$any: {
															$alias: 'a',
															$expr: {
																a: {
																	application_type: {
																		$any: {
																			$alias: 't',
																			$expr: {
																				t: { supports_multicontainer: false },
																			},
																		},
																	},
																},
															},
														},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		})) as AnyObject[];
		if (_.some(releases, r => r.image__is_part_of__release > 1)) {
			throw new sbvrUtils.ForbiddenError(
				'This application type does not support multicontainer.',
			);
		}
	},
});

addDeleteHookForDependents('image__is_part_of__release', [
	['image_label', 'release_image'],
	['image_environment_variable', 'release_image'],
]);
