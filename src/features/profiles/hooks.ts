import { dbModule, hooks, permissions, sbvrUtils } from '@balena/pinejs';
import { ADVISORY_LOCK_NAMESPACES } from '../../lib/config.js';
import { withValidatedValues, z } from '../../infra/validation/index.js';
import type Model from '../../balena-model.js';

const CATALOG_LOCK_NAMESPACE_KEY = 'application_profile_catalog__application';
dbModule.registerTransactionLockNamespace(
	CATALOG_LOCK_NAMESPACE_KEY,
	ADVISORY_LOCK_NAMESPACES.application_profile_catalog__application,
);

// Matches docker-compose profile name semantics, see
// https://docs.docker.com/compose/how-tos/profiles/
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

const profileName = z.string().regex(PROFILE_NAME_REGEX);

const imageProfileSchema = z.looseObject({
	profile_name: profileName,
});

const applicationProfileSchema = z.looseObject({
	activates__profile_name: profileName,
});

const deviceProfileOverrideSchema = z.looseObject({
	overrides__profile_name: profileName,
	is_active: z.boolean(),
});

const deviceProfileOverrideUpdateSchema = z.looseObject({
	is_active: z.boolean().optional(),
});

const applicationProfileCatalogSchema = z.looseObject({
	catalogs__profile_name: profileName,
});

const applicationProfileCatalogUpdateSchema = z.looseObject({});

type ProfileResource = Extract<
	keyof Model,
	| 'image_profile'
	| 'application_profile'
	| 'device_profile_override'
	| 'application_profile_catalog'
>;

const registerProfileValidation = (
	resource: ProfileResource,
	schema: z.ZodType<AnyObject>,
	updateSchema: z.ZodType<AnyObject> = schema,
) => {
	hooks.addPureHook('POST', 'resin', resource, {
		POSTPARSE: withValidatedValues(schema),
	});
	hooks.addPureHook('PUT', 'resin', resource, {
		POSTPARSE: withValidatedValues(schema),
	});
	hooks.addPureHook('PATCH', 'resin', resource, {
		POSTPARSE: withValidatedValues(updateSchema),
	});
};

registerProfileValidation('image_profile', imageProfileSchema);
registerProfileValidation('application_profile', applicationProfileSchema);
registerProfileValidation(
	'device_profile_override',
	deviceProfileOverrideSchema,
	deviceProfileOverrideUpdateSchema,
);
registerProfileValidation(
	'application_profile_catalog',
	applicationProfileCatalogSchema,
	applicationProfileCatalogUpdateSchema,
);

hooks.addPureHook('POST', 'resin', 'image_profile', {
	POSTRUN: async (args) => {
		const { profile_name: catalogProfileName, release_image: releaseImageId } =
			args.request.values;

		const [release] = await args.api.get({
			resource: 'release',
			options: {
				$select: 'belongs_to__application',
				$filter: {
					release_image: {
						$any: {
							$alias: 'ri',
							$expr: { ri: { id: releaseImageId } },
						},
					},
				},
			},
		});
		if (release == null) {
			return;
		}
		const applicationId = release.belongs_to__application.__id;

		await args.tx.getTxLevelLock(CATALOG_LOCK_NAMESPACE_KEY, applicationId);

		const existing = await args.api.get({
			resource: 'application_profile_catalog',
			id: {
				application: applicationId,
				catalogs__profile_name: catalogProfileName,
			},
			options: { $select: 'id' },
		});
		if (existing != null) {
			return;
		}

		await args.api.post({
			resource: 'application_profile_catalog',
			passthrough: { req: permissions.root },
			body: {
				application: applicationId,
				catalogs__profile_name: catalogProfileName,
			},
			options: { returnResource: false },
		});
	},
});

interface ImageProfileDeleteCustomObject {
	profileNamesByApplicationId?: Map<number, Set<string>>;
}

hooks.addPureHook('DELETE', 'resin', 'image_profile', {
	PRERUN: async (args) => {
		const ids = await sbvrUtils.getAffectedIds(args);
		if (ids.length === 0) {
			return;
		}

		const imageProfiles = await args.api.get({
			resource: 'image_profile',
			options: {
				$select: 'profile_name',
				$filter: { id: { $in: ids } },
				$expand: {
					release_image: {
						$select: 'id',
						$expand: {
							is_part_of__release: { $select: 'belongs_to__application' },
						},
					},
				},
			},
		});

		const profileNamesByApplicationId = new Map<number, Set<string>>();
		for (const imageProfile of imageProfiles) {
			const applicationId =
				imageProfile.release_image[0].is_part_of__release[0]
					.belongs_to__application.__id;
			const profileNames =
				profileNamesByApplicationId.get(applicationId) ?? new Set<string>();
			profileNames.add(imageProfile.profile_name);
			profileNamesByApplicationId.set(applicationId, profileNames);
		}
		(
			args.request.custom as ImageProfileDeleteCustomObject
		).profileNamesByApplicationId = profileNamesByApplicationId;
	},
	POSTRUN: async (args) => {
		const { profileNamesByApplicationId } = args.request
			.custom as ImageProfileDeleteCustomObject;
		if (
			profileNamesByApplicationId == null ||
			profileNamesByApplicationId.size === 0
		) {
			return;
		}

		const sortedEntries = [...profileNamesByApplicationId.entries()].sort(
			([a], [b]) => a - b,
		);
		for (const [applicationId, profileNames] of sortedEntries) {
			const candidateProfileNames = [...profileNames];

			await args.tx.getTxLevelLock(CATALOG_LOCK_NAMESPACE_KEY, applicationId);

			const stillReferenced = await args.api.get({
				resource: 'image_profile',
				options: {
					$select: 'profile_name',
					$filter: {
						profile_name: { $in: candidateProfileNames },
						release_image: {
							$any: {
								$alias: 'ri',
								$expr: {
									ri: {
										is_part_of__release: {
											$any: {
												$alias: 'r',
												$expr: {
													r: { belongs_to__application: applicationId },
												},
											},
										},
									},
								},
							},
						},
					},
				},
			});
			const stillReferencedNames = new Set(
				stillReferenced.map((row) => row.profile_name),
			);
			const deadProfileNames = candidateProfileNames.filter(
				(name) => !stillReferencedNames.has(name),
			);
			if (deadProfileNames.length === 0) {
				continue;
			}

			await args.api.delete({
				resource: 'application_profile_catalog',
				passthrough: { req: permissions.root },
				options: {
					$filter: {
						application: applicationId,
						catalogs__profile_name: { $in: deadProfileNames },
					},
				},
			});
		}
	},
});
