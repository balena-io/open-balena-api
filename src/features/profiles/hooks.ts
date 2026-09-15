import { errors, hooks, permissions, sbvrUtils } from '@balena/pinejs';
import { withValidatedValues, z } from '../../infra/validation/index.js';
import type Model from '../../balena-model.js';

const { ConflictError } = errors;

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

const stillHasImageProfile = async (
	tx: Tx,
	applicationId: number,
	catalogProfileName: string,
): Promise<boolean> => {
	const rows = await sbvrUtils.api.resin.get({
		resource: 'image_profile',
		passthrough: { tx, req: permissions.rootRead },
		options: {
			$top: 1,
			$select: 'id',
			$filter: {
				profile_name: catalogProfileName,
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
	return rows.length > 0;
};

hooks.addPureHook('POST', 'resin', 'image_profile', {
	POSTRUN: async (args) => {
		const { profile_name: catalogProfileName, release_image: releaseImageId } =
			args.request.values;

		const releaseImage = await sbvrUtils.api.resin.get({
			resource: 'image__is_part_of__release',
			id: releaseImageId,
			passthrough: { tx: args.tx, req: permissions.rootRead },
			options: {
				$select: 'id',
				$expand: {
					is_part_of__release: { $select: 'belongs_to__application' },
				},
			},
		});
		if (releaseImage == null) {
			return;
		}
		const applicationId =
			releaseImage.is_part_of__release[0].belongs_to__application.__id;

		const existing = await sbvrUtils.api.resin.get({
			resource: 'application_profile_catalog',
			id: {
				application: applicationId,
				catalogs__profile_name: catalogProfileName,
			},
			passthrough: { tx: args.tx, req: permissions.rootRead },
			options: { $select: 'id' },
		});
		if (existing != null) {
			return;
		}

		try {
			await sbvrUtils.api.resin.post({
				resource: 'application_profile_catalog',
				passthrough: { tx: args.tx, req: permissions.root },
				body: {
					application: applicationId,
					catalogs__profile_name: catalogProfileName,
				},
				options: { returnResource: false },
			});
		} catch (err) {
			// Two images in the same release (or two concurrent releases) can carry the
			// same profile name - a concurrent insert winning this race is a success,
			// not an error, and must not fail the image_profile creation that triggered it.
			if (err instanceof ConflictError) {
				return;
			}
			throw err;
		}
	},
});

hooks.addPureHook('DELETE', 'resin', 'image_profile', {
	PRERUN: async (args) => {
		const ids = await sbvrUtils.getAffectedIds(args);
		if (ids.length === 0) {
			return;
		}

		const rows = await sbvrUtils.api.resin.get({
			resource: 'image_profile',
			passthrough: { tx: args.tx, req: permissions.rootRead },
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

		const candidatesByKey = new Map<
			string,
			{ applicationId: number; catalogProfileName: string }
		>();
		for (const row of rows) {
			const applicationId =
				row.release_image[0].is_part_of__release[0].belongs_to__application
					.__id;
			candidatesByKey.set(`${applicationId}|${row.profile_name}`, {
				applicationId,
				catalogProfileName: row.profile_name,
			});
		}
		args.request.custom.profileCatalogCandidates = [
			...candidatesByKey.values(),
		];
	},
	POSTRUN: async (args) => {
		const candidates = args.request.custom.profileCatalogCandidates as
			Array<{ applicationId: number; catalogProfileName: string }> | undefined;
		if (!candidates?.length) {
			return;
		}

		// Safe to check "does image_profile still exist" here, even though the just-deleted
		// rows are gone: we're inside the same not-yet-committed tx, so this already reflects
		// the post-delete state.
		await Promise.all(
			candidates.map(async ({ applicationId, catalogProfileName }) => {
				if (
					await stillHasImageProfile(args.tx, applicationId, catalogProfileName)
				) {
					return;
				}
				await sbvrUtils.api.resin.delete({
					resource: 'application_profile_catalog',
					id: {
						application: applicationId,
						catalogs__profile_name: catalogProfileName,
					},
					passthrough: { tx: args.tx, req: permissions.root },
				});
			}),
		);
	},
});
