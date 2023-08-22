import {
	dbModule,
	sbvrUtils,
	hooks,
	errors,
	permissions,
} from '@balena/pinejs';
import type { FilterObj } from 'pinejs-client-core';
import semverLib from 'semver';
import { ADVISORY_LOCK_NAMESPACES } from '../../../lib/config';
import { groupByMap } from '../../../lib/utils';
import type { PickDeferred, Release } from '../../../balena-model';
import {
	captureException,
	ThisShouldNeverHappenError,
} from '../../../infra/error-handling';

const { BadRequestError } = errors;

const ADVISORY_LOCK_NAMESPACE_KEY =
	'release__revision__belongs_to__application';
dbModule.registerTransactionLockNamespace(
	ADVISORY_LOCK_NAMESPACE_KEY,
	ADVISORY_LOCK_NAMESPACES[ADVISORY_LOCK_NAMESPACE_KEY],
);

const getAdvisoryLockForApp = async (tx: Tx, appId: number) => {
	await tx.getTxLevelLock(ADVISORY_LOCK_NAMESPACE_KEY, appId);
};

const preventChangingFinalToDraft = async (
	args: sbvrUtils.HookArgs & { tx: Tx },
) => {
	const { api, request } = args;
	const { is_final } = request.custom as PatchCustomObject;
	if (is_final !== false) {
		return;
	}
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
				revision: { $ne: null },
			},
		},
	});
	if (finalizedReleases.length > 0) {
		throw new BadRequestError(
			'Finalized releases cannot be converted to draft.',
		);
	}
};

const getNextRevision = async (
	api: sbvrUtils.PinejsClient,
	applicationId: number,
	semverObject: semverLib.SemVer,
	variant: string,
) => {
	const [releaseWithLatestRevision] = (await api.get({
		resource: 'release',
		options: {
			$top: 1,
			$select: 'revision',
			$filter: {
				belongs_to__application: applicationId,
				semver_major: semverObject.major,
				semver_minor: semverObject.minor,
				semver_patch: semverObject.patch,
				semver_prerelease: semverObject.prerelease.join('.'),
				variant,
				revision: { $ne: null },
			},
			$orderby: {
				revision: 'desc',
			},
		},
	})) as Array<NonNullableField<Pick<Release, 'revision'>, 'revision'>>;

	return releaseWithLatestRevision != null
		? releaseWithLatestRevision.revision + 1
		: 0;
};

interface CustomObjectBase {
	is_final?: boolean;
	semverObject?: semverLib.SemVer;
}

const parseReleaseVersioningFields: (args: sbvrUtils.HookArgs) => void = ({
	request,
}) => {
	const custom = request.custom as CustomObjectBase;
	if (request.values.semver != null) {
		const semverObject = semverLib.parse(request.values.semver);
		if (semverObject == null) {
			throw new errors.BadRequestError('Invalid semver format');
		}
		request.values.semver_major = semverObject.major;
		request.values.semver_minor = semverObject.minor;
		request.values.semver_patch = semverObject.patch;
		request.values.semver_prerelease = semverObject.prerelease.join('.');
		request.values.semver_build = semverObject.build.join('.');
		custom.semverObject = semverObject;
	} else {
		// the semver part fields are only settable through the computed term
		for (const semverPart of [
			'semver_major',
			'semver_minor',
			'semver_patch',
			'semver_prerelease',
			'semver_build',
		]) {
			if (semverPart in request.values) {
				delete request.values[semverPart];
			}
		}
	}

	// Keep computed terms as custom values and remove them from the body,
	// since they do not exist in the DB.
	custom.is_final = request.values.is_final;
	delete request.values.is_final;
	delete request.values.semver;
};

const DEFAULT_SEMVER = semverLib.parse('0.0.0');
if (DEFAULT_SEMVER == null) {
	throw ThisShouldNeverHappenError(
		'Error while parsing the default server object!',
	);
}

const REVISION_REGEXP = /^rev(\d+)$/;

const checkNotDifferentRevision = (
	semverObject: semverLib.SemVer,
	revision: number,
) => {
	const userProvidedRevisions = semverObject.build
		.map((b) => REVISION_REGEXP.exec(b)?.[1])
		.filter((revN) => revN != null);

	if (userProvidedRevisions.some((rev) => revision.toString() !== rev)) {
		throw new BadRequestError(
			'The provided revision does not match the autogenerated one.',
		);
	}
};

hooks.addPureHook('POST', 'resin', 'release', {
	POSTPARSE: async (args) => {
		parseReleaseVersioningFields(args);

		const { request } = args;
		request.values.variant ??= '';
		const custom = request.custom as CustomObjectBase;
		// Releases are by final by default
		custom.is_final ??= true;
	},
	POSTRUN: async ({ api, request, result: releaseId, tx }) => {
		const custom = request.custom as CustomObjectBase;
		if (releaseId == null || !custom.is_final) {
			return;
		}
		const semverObject = custom.semverObject ?? DEFAULT_SEMVER;
		await getAdvisoryLockForApp(tx, request.values.belongs_to__application);
		const revision = await getNextRevision(
			api,
			request.values.belongs_to__application,
			semverObject,
			request.values.variant,
		);

		checkNotDifferentRevision(semverObject, revision);

		const finalizedAt = new Date();
		await api.patch({
			resource: 'release',
			// Needs root because revision is not settable.
			passthrough: { req: permissions.root },
			id: releaseId,
			body: {
				revision,
				is_finalized_at__date: finalizedAt,
			},
		});
	},
});

interface PatchCustomObject extends CustomObjectBase {
	releasesToSetRevision?: Array<
		Pick<Release, 'id' | 'semver' | 'variant' | 'is_finalized_at__date'> &
			PickDeferred<Release, 'belongs_to__application'>
	>;
}

const setReleasesToSetRevision = async (
	args: sbvrUtils.HookArgs & { tx: Tx },
) => {
	const { request, api } = args;
	const custom = request.custom as PatchCustomObject;
	const filters: FilterObj[] = [];
	if (custom.is_final) {
		filters.push({
			revision: { $eq: null },
		});
	}
	const uniqueConstraintPartFilters: FilterObj[] = [];
	if (custom.semverObject != null) {
		uniqueConstraintPartFilters.push({
			revision: { $ne: null },
			$not: {
				semver_major: custom.semverObject.major,
				semver_minor: custom.semverObject.minor,
				semver_patch: custom.semverObject.patch,
				semver_prerelease: custom.semverObject.prerelease.join('.'),
			},
		});
	}
	if (request.values.belongs_to__application != null) {
		uniqueConstraintPartFilters.push({
			revision: { $ne: null },
			belongs_to__application: {
				$ne: request.values.belongs_to__application,
			},
		});
	}
	if (request.values.variant != null) {
		uniqueConstraintPartFilters.push({
			revision: { $ne: null },
			variant: {
				$ne: request.values.variant,
			},
		});
	}
	filters.push(...uniqueConstraintPartFilters);
	if (filters.length === 0) {
		// no field of interest was PATCHed
		return;
	}
	const releaseIds = await sbvrUtils.getAffectedIds(args);
	if (!releaseIds.length) {
		return;
	}
	const releasesToSetRevision = (await api.get({
		resource: 'release',
		options: {
			$select: [
				'id',
				'semver',
				'variant',
				'is_finalized_at__date',
				'belongs_to__application',
			],
			$filter: {
				id: { $in: releaseIds },
				...(filters.length === 1
					? filters[0]
					: {
							$or: filters,
					  }),
			},
			$orderby: [
				// order first by application, so that the advisory locks are picked
				// in a consistent order across requests so that we can avoid deadlocks
				{ belongs_to__application: 'asc' },
				// order by finalization date & id in order to have predictable revision ordering
				{ is_finalized_at__date: 'asc' },
				{ id: 'asc' },
			],
		},
	})) as NonNullable<PatchCustomObject['releasesToSetRevision']>;
	if (!releasesToSetRevision.length) {
		return;
	}
	custom.releasesToSetRevision = releasesToSetRevision;

	// When changing the any part of the unique constraint,
	// set the revision to null so that
	// we don't end up with duplicate revisions.
	// We will set the correct value in PRERESPOND
	if (uniqueConstraintPartFilters.length === 0) {
		return;
	}
	await api.patch({
		resource: 'release',
		// Needs root because revision is not settable.
		passthrough: { req: permissions.root },
		options: {
			$filter: {
				id: { $in: releasesToSetRevision.map((r) => r.id) },
				revision: { $ne: null },
			},
		},
		body: {
			revision: null,
		},
	});
};

hooks.addPureHook('PATCH', 'resin', 'release', {
	POSTPARSE: parseReleaseVersioningFields,
	PRERUN: async (args) => {
		await Promise.all([
			setReleasesToSetRevision(args),
			preventChangingFinalToDraft(args),
		]);
	},
	POSTRUN: async ({ api, request, tx, req }) => {
		const { is_final, releasesToSetRevision, semverObject } =
			request.custom as PatchCustomObject;
		if (releasesToSetRevision == null) {
			return;
		}
		const patchedAppId = request.values.belongs_to__application;
		const releasesByApp =
			patchedAppId != null
				? new Map([[parseInt(patchedAppId, 10), releasesToSetRevision]])
				: groupByMap(
						releasesToSetRevision,
						(r) => r.belongs_to__application.__id,
				  );

		const releasesByAppEntries = Array.from(releasesByApp.entries());

		// lift all locks upfront
		for (const [appId] of releasesByAppEntries) {
			await getAdvisoryLockForApp(tx, appId);
		}

		await Promise.all(
			releasesByAppEntries.map(async ([appId, releasesOfApp]) => {
				const releasesByVariant =
					request.values.variant != null
						? new Map([[request.values.variant as string, releasesOfApp]])
						: groupByMap(releasesOfApp, (r) => r.variant);

				await Promise.all(
					Array.from(releasesByVariant.entries()).map(
						async ([variant, releases]) => {
							if (semverObject != null) {
								const nextRevision = await getNextRevision(
									api,
									appId,
									semverObject,
									variant,
								);
								releases.forEach((_release, index) => {
									checkNotDifferentRevision(semverObject, nextRevision + index);
								});

								await Promise.all(
									releases.map(async (release, index) => {
										await api.patch({
											resource: 'release',
											// Needs root because revision is not settable.
											passthrough: { req: permissions.root },
											id: release.id,
											body: {
												...(is_final &&
													release.is_finalized_at__date == null && {
														is_finalized_at__date: new Date(),
													}),
												revision: nextRevision + index,
											},
										});
									}),
								);
							} else {
								// needs to be done one by one, since otherwise more than one releases might already
								// be in the same semver and they could end up with the same revision as well.
								for (const release of releases) {
									const releaseSemverObject = semverLib.parse(release.semver);
									if (releaseSemverObject == null) {
										const sentryError = new BadRequestError(
											'Could not parse the semver a pre-existing release',
										);
										captureException(
											sentryError,
											`Could not parse the semver of ${release.id} while updating release revision.`,
											{ req },
										);
										throw new BadRequestError(
											'Could not parse the semver a pre-existing release',
										);
									}
									const nextRevision = await getNextRevision(
										api,
										appId,
										releaseSemverObject,
										variant,
									);
									checkNotDifferentRevision(releaseSemverObject, nextRevision);

									await api.patch({
										resource: 'release',
										// Needs root because revision is not settable.
										passthrough: { req: permissions.root },
										id: release.id,
										body: {
											...(is_final &&
												release.is_finalized_at__date == null && {
													is_finalized_at__date: new Date(),
												}),
											revision: nextRevision,
										},
									});
								}
							}
						},
					),
				);
			}),
		);
	},
});
