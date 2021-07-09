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

const getAdvisoryLockForApp = (tx: Tx, appId: number) => {
	if (!Number.isInteger(appId)) {
		// This should never happen, since Pine has already validated the value,
		// but double-check it just to be sure what we are passing to the advisory lock.
		throw new errors.BadRequestError(
			'Invalid belongs_to__application parameter',
		);
	}
	tx.executeSql(`SELECT pg_advisory_xact_lock($1, $2);`, [
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
}

const parseReleaseVersioningFields: (args: sbvrUtils.HookArgs) => void = ({
	request,
	req,
}) => {
	const { is_final, release_type } = request.values;
	if (typeof is_final === 'boolean') {
		// TODO[release versioning next step]: Drop this once we move the release_type to a translation
		request.values.release_type = is_final ? 'final' : 'draft';
	} else if (
		typeof release_type === 'string' &&
		release_type in releaseTypeToFinalMap
	) {
		// TODO[release versioning next step]: Drop this once we move the release_type to a translation
		request.values.is_final =
			releaseTypeToFinalMap[release_type as keyof typeof releaseTypeToFinalMap];
	}

	if (
		request.values.is_final === true ||
		(req.method === 'POST' && request.values.is_final === undefined)
	) {
		request.values.is_finalized_at__date = new Date();
	} else if (request.values.is_final === false) {
		request.values.revision = null;
	}

	if (request.values.semver != null) {
		const semverMatches = PLAIN_SEMVER_REGEX.exec(request.values.semver);
		if (semverMatches == null) {
			throw new errors.BadRequestError('Invalid semver format');
		}
		request.values.semver_major = parseInt(semverMatches[1], 10);
		request.values.semver_minor = parseInt(semverMatches[2], 10);
		request.values.semver_patch = parseInt(semverMatches[3], 10);
	}

	// Keep is_final as a custom value and remove it from the body,
	// since is_final is computed and doesn't exist in the DB.
	const custom = request.custom as CustomObjectBase;
	custom.is_final = request.values.is_final;
	delete request.values.is_final;
};

hooks.addPureHook('POST', 'resin', 'release', {
	POSTPARSE: async (args) => {
		parseReleaseVersioningFields(args);

		const { request } = args;
		if (request.values.semver === undefined) {
			request.values.semver = '0.0.0';
			request.values.semver_major = 0;
			request.values.semver_minor = 0;
			request.values.semver_patch = 0;
		}

		const custom = request.custom as CustomObjectBase;
		// Releases are by final by default
		custom.is_final ??= true;
		// Set it to NULL, so that concurrent POSTs don't end up all getting 0
		// from the column's default value. We will set the correct value in PRERESPOND.
		request.values.revision = null;
	},
	PRERESPOND: async ({ api, request, result, tx }) => {
		const [releaseId] = request.affectedIds!;
		const custom = request.custom as CustomObjectBase;
		if (releaseId == null || !custom.is_final) {
			return;
		}
		getAdvisoryLockForApp(tx, request.values.belongs_to__application);
		const revision = await getNextRevision(
			api,
			request.values.belongs_to__application,
			request.values.semver,
		);
		await api.patch({
			resource: 'release',
			// Needs root because revision is not settable.
			passthrough: { req: permissions.root },
			id: releaseId,
			body: {
				revision,
			},
		});
		// In case { returnResource: false } was not used
		if (result != null) {
			const [release] = result.d;
			release.is_final = custom.is_final;
			release.revision = revision;
		}
	},
});

interface PatchCustomObject extends CustomObjectBase {
	releasesToSetRevision?: Array<
		Pick<Release, 'id' | 'semver' | 'is_finalized_at__date'> &
			PickDeferred<Release, 'belongs_to__application'>
	>;
}

hooks.addPureHook('PATCH', 'resin', 'release', {
	POSTPARSE: async (args) => {
		parseReleaseVersioningFields(args);

		const { request } = args;
		if (request.values.semver !== undefined) {
			// So that we don't have duplicate 0's.
			// We will set the correct value in PRERESPOND
			request.values.revision = null;
		}
	},
	PRERUN: async (args) => {
		const { api, request } = args;
		const releaseIds = await sbvrUtils.getAffectedIds(args);
		const custom = request.custom as PatchCustomObject;
		if (!releaseIds.length) {
			return;
		}
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
		if (request.values.semver != null) {
			filters.push({
				$or: {
					// Check both fields, so that instances of this deploy step, can work with instances of the next step.
					revision: { $ne: null },
					// TODO[release versioning next step]: Drop this after re-migrating all data on step 2:
					release_type: 'final',
				},
				semver: { $ne: request.values.semver },
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
			// not field of interest was PATCHed
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
	},
	PRERESPOND: async ({ api, request, tx }) => {
		const { is_final, releasesToSetRevision } =
			request.custom as PatchCustomObject;
		if (releasesToSetRevision == null) {
			return;
		}
		const patchedAppId = request.values.belongs_to__application;
		let releasesByApp: Map<number, typeof releasesToSetRevision>;
		if (patchedAppId != null) {
			releasesByApp = new Map([patchedAppId, releasesToSetRevision]);
		} else {
			releasesByApp = groupByMap(
				releasesToSetRevision,
				(r) => r.belongs_to__application.__id,
			);
		}

		const entries = Array.from(releasesByApp.entries());
		// lift all locks upfront
		for (const [appId] of entries) {
			getAdvisoryLockForApp(tx, appId);
		}

		await Promise.all(
			entries.map(async ([appId, releases]) => {
				if (request.values.semver != null) {
					const nextRevision = await getNextRevision(
						api,
						appId,
						request.values.semver,
					);
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
