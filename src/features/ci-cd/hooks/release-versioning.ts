import { sbvrUtils, hooks, errors, permissions } from '@balena/pinejs';
import type { FilterObj } from 'pinejs-client-core';
import * as _ from 'lodash';
import { ADVISORY_LOCK_NAMESPACES } from '../../../lib/config';
import { groupByMap } from '../../../lib/utils';
import type { PickDeferred, Release } from '../../../balena-model';

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

const getAdvisoryLockForApp = async (tx: Tx, appId: number) => {
	if (!Number.isInteger(appId)) {
		// This should never happen, since Pine has already validated the value,
		// but double-check it just to be sure what we are passing to the advisory lock.
		throw new errors.BadRequestError(
			'Invalid belongs_to__application parameter',
		);
	}
	await tx.executeSql(`SELECT pg_advisory_xact_lock($1, $2);`, [
		ADVISORY_LOCK_NAMESPACES.release__revision__belongs_to__application,
		appId,
	]);
};

const getNextRevision = async (
	api: sbvrUtils.PinejsClient,
	applicationId: number,
	semver: string,
) => {
	const [releaseWithLatestRevision] = (await api.get({
		resource: 'release',
		options: {
			$top: 1,
			$select: 'revision',
			$filter: {
				belongs_to__application: applicationId,
				semver,
				// Check both fields, so that instances of this deploy step, can work with instances of the next step.
				revision: { $ne: null },
				// TODO[release versioning next step]: Drop this after re-migrating all data on step 2:
				release_type: 'final',
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

const releaseTypeToFinalMap = {
	draft: false,
	final: true,
};

const PLAIN_SEMVER_REGEX = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;

interface CustomObjectBase {
	is_final?: boolean;
	semver?: string;
}

const parseReleaseVersioningFields: (args: sbvrUtils.HookArgs) => void = ({
	request,
}) => {
	const { is_final, release_type } = request.values;
	if (typeof is_final === 'boolean') {
		// TODO[release versioning next step]: Drop this once we move the release_type to a translation
		const inferredReleaseType = is_final ? 'final' : 'draft';
		if (release_type != null && release_type !== inferredReleaseType) {
			throw new errors.BadRequestError(
				'Conflict between the provided is_final and release_type values',
			);
		}
		request.values.release_type = inferredReleaseType;
	} else if (
		typeof release_type === 'string' &&
		release_type in releaseTypeToFinalMap
	) {
		// TODO[release versioning next step]: Drop this once we move the release_type to a translation
		request.values.is_final =
			releaseTypeToFinalMap[release_type as keyof typeof releaseTypeToFinalMap];
	}

	if (request.values.semver != null) {
		const semverMatches = PLAIN_SEMVER_REGEX.exec(request.values.semver);
		if (semverMatches == null) {
			throw new errors.BadRequestError('Invalid semver format');
		}
		request.values.semver_major = parseInt(semverMatches[1], 10);
		request.values.semver_minor = parseInt(semverMatches[2], 10);
		request.values.semver_patch = parseInt(semverMatches[3], 10);
	} else {
		// the semver part fields are only settable through the computed term
		['semver_major', 'semver_minor', 'semver_patch'].forEach((semverPart) => {
			if (request.values[semverPart] != null) {
				delete request.values[semverPart];
			}
		});
	}

	// Keep computed terms as custom values and remove them from the body,
	// since they do not exist in the DB.
	const custom = request.custom as CustomObjectBase;
	custom.is_final = request.values.is_final;
	custom.semver = request.values.semver;
	delete request.values.is_final;
	delete request.values.semver;
};

const DEFAULT_SEMVER = '0.0.0';

hooks.addPureHook('POST', 'resin', 'release', {
	POSTPARSE: async (args) => {
		parseReleaseVersioningFields(args);

		const { request } = args;
		const custom = request.custom as CustomObjectBase;
		// Releases are by final by default
		custom.is_final ??= true;
	},
	POSTRUN: async ({ api, request, result: releaseId, tx }) => {
		const custom = request.custom as CustomObjectBase;
		if (releaseId == null || !custom.is_final) {
			return;
		}
		await getAdvisoryLockForApp(tx, request.values.belongs_to__application);
		const revision = await getNextRevision(
			api,
			request.values.belongs_to__application,
			custom.semver ?? DEFAULT_SEMVER,
		);
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
		Pick<Release, 'id' | 'semver' | 'is_finalized_at__date'> &
			PickDeferred<Release, 'belongs_to__application'>
	>;
}

hooks.addPureHook('PATCH', 'resin', 'release', {
	POSTPARSE: parseReleaseVersioningFields,
	PRERUN: async (args) => {
		const { api, request } = args;
		const custom = request.custom as PatchCustomObject;
		const filters: FilterObj[] = [];
		if (custom.is_final) {
			filters.push({
				$or: {
					// Check both fields, so that instances of this deploy step, can work with instances of the next step.
					revision: { $eq: null },
					// TODO[release versioning next step]: Drop this after re-migrating all data on step 2:
					release_type: 'draft',
				},
			});
		}
		if (custom.semver != null) {
			filters.push({
				$or: {
					// Check both fields, so that instances of this deploy step, can work with instances of the next step.
					revision: { $ne: null },
					// TODO[release versioning next step]: Drop this after re-migrating all data on step 2:
					release_type: 'final',
				},
				semver: { $ne: custom.semver },
			});
		}
		if (request.values.belongs_to__application != null) {
			filters.push({
				$or: {
					// Check both fields, so that instances of this deploy step, can work with instances of the next step.
					revision: { $ne: null },
					// TODO[release versioning next step]: Drop this after re-migrating all data on step 2:
					release_type: 'final',
				},
				belongs_to__application: {
					$ne: request.values.belongs_to__application,
				},
			});
		}
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

		if (custom.semver == null) {
			return;
		}
		// When changing the semver, set the revision to null so that
		// we don't end up with duplicate revisions.
		// We will set the correct value in PRERESPOND
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
	},
	POSTRUN: async ({ api, request, tx }) => {
		const { is_final, releasesToSetRevision, semver } =
			request.custom as PatchCustomObject;
		if (releasesToSetRevision == null) {
			return;
		}
		const patchedAppId = request.values.belongs_to__application;
		let releasesByApp: Map<number, typeof releasesToSetRevision>;
		if (patchedAppId != null) {
			releasesByApp = new Map([
				[parseInt(patchedAppId, 10), releasesToSetRevision],
			]);
		} else {
			releasesByApp = groupByMap(
				releasesToSetRevision,
				(r) => r.belongs_to__application.__id,
			);
		}

		const entries = Array.from(releasesByApp.entries());
		// lift all locks upfront
		for (const [appId] of entries) {
			await getAdvisoryLockForApp(tx, appId);
		}

		await Promise.all(
			entries.map(async ([appId, releases]) => {
				if (semver != null) {
					const nextRevision = await getNextRevision(api, appId, semver);
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
						const nextRevision = await getNextRevision(
							api,
							appId,
							release.semver,
						);
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
			}),
		);
	},
});
