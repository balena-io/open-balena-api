import { randomUUID } from 'crypto';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import type { Release } from '../src/balena-model';
import * as fixtures from './test-lib/fixtures';
import { expect } from './test-lib/chai';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import { pineTest } from './test-lib/pinetest';

describe('releases', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let newRelease: AnyObject;

	before(async () => {
		fx = await fixtures.load('07-releases');
		user = fx.users.admin;
		newRelease = {
			belongs_to__application: fx.applications.app1.id,
			commit: '57d00829-492d-4124-bca2-fde28df9e590',
			status: 'success',
			composition: {},
			source: 'test',
			start_timestamp: Date.now(),
		};
	});
	after(async () => {
		await fixtures.clean(fx);
	});

	it('should be able to create a new failed release for a given commit', async () => {
		await supertest(user)
			.post(`/${version}/release`)
			.send({
				...newRelease,
				status: 'error',
			})
			.expect(201);
	});

	it('should be able to create an extra failed release for the same commit', async () => {
		await supertest(user)
			.post(`/${version}/release`)
			.send({
				...newRelease,
				status: 'error',
			})
			.expect(201);
	});

	it('should be able to create a new successful release for the same commit', async () => {
		await supertest(user)
			.post(`/${version}/release`)
			.send(newRelease)
			.expect(201);
	});

	it('should disallow creating an additional successful release for the same commit', async () => {
		const { body } = await supertest(user)
			.post(`/${version}/release`)
			.send(newRelease)
			.expect(400);
		expect(body).that.equals(
			'It is necessary that each application that owns a release1 that has a status that is equal to "success" and has a commit1, owns at most one release2 that has a status that is equal to "success" and has a commit2 that is equal to the commit1.',
		);
	});

	it('should be able to create a new successful release for the same commit in a different application', async () => {
		await supertest(user)
			.post(`/${version}/release`)
			.send({
				...newRelease,
				belongs_to__application: fx.applications.app2.id,
			})
			.expect(201);
	});
});

const getTopRevision = async (
	pineTestInstance: typeof pineTest,
	appId: number,
	semver: string,
) => {
	const {
		body: [topRevisionRelease],
	} = await pineTestInstance
		.get<Array<Pick<Release, 'revision'>>>({
			resource: 'release',
			options: {
				$select: 'revision',
				$filter: {
					belongs_to__application: appId,
					semver,
					revision: { $ne: null },
				},
				$orderby: {
					revision: 'desc',
				},
			},
		})
		.expect(200);
	expect(topRevisionRelease.revision).to.be.a('number');
	return topRevisionRelease.revision!;
};

/** must be more than 3 */
const RELEASE_FINALIZATION_TEST_CONCURENCY = 10;
expect(RELEASE_FINALIZATION_TEST_CONCURENCY).to.be.greaterThanOrEqual(
	3,
	'Please define a RELEASE_FINALIZATION_TEST_CONCURENCY >= 3',
);
const RELEASE_FINALIZATION_CONCURENCY_DELAY_FACTOR =
	2 * RELEASE_FINALIZATION_TEST_CONCURENCY;

describe('versioning releases', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let release1: AnyObject;
	let release2: AnyObject;
	let newRelease: AnyObject;
	let newReleaseBody: AnyObject;
	let pineUser: typeof pineTest;
	let topRevision: number;

	before(async () => {
		fx = await fixtures.load('07-releases');
		user = fx.users.admin;
		pineUser = pineTest.clone({
			passthrough: { user },
		});
		release1 = fx.releases.release1;
		release2 = fx.releases.release2;
		newReleaseBody = {
			belongs_to__application: fx.applications.app1.id,
			commit: 'test-commit',
			status: 'success',
			release_version: 'v10.1.1',
			composition: {},
			source: 'test',
			start_timestamp: Date.now(),
		};
	});
	after(async () => {
		await fixtures.clean(fx);
	});

	it('should succeed to return versioned releases', async () => {
		const res = await supertest(user)
			.get(`/${version}/release?$filter=release_version ne null`)
			.expect(200);
		expect(res.body.d).to.have.lengthOf(2);
		(res.body.d as AnyObject[]).forEach((release) => {
			expect(release).to.have.property('release_version').that.is.a('string');
		});
	});

	it('should succeed to return unversioned releases', async () => {
		const res = await supertest(user)
			.get(`/${version}/release?$filter=release_version eq null`)
			.expect(200);
		expect(res.body.d).to.have.lengthOf(2);
		(res.body.d as AnyObject[]).forEach((release) => {
			expect(release).to.have.property('release_version').that.is.null;
		});
	});

	it('should succeed in PATCHing a release version', async () => {
		const releaseVersion = 'v1.2.3';
		await supertest(user)
			.patch(`/${version}/release(${release1.id})`)
			.send({
				release_version: releaseVersion,
			})
			.expect(200);
		const res = await supertest(user)
			.get(`/${version}/release(${release1.id})`)
			.expect(200);
		expect(res.body.d[0])
			.to.have.property('release_version')
			.that.equals(releaseVersion);
	});

	it('should fail to PATCH a duplicate release version', async () => {
		const releaseVersion = 'v1.2.3';
		await supertest(user)
			.patch(`/${version}/release(${release2.id})`)
			.send({
				release_version: releaseVersion,
			})
			.expect(400);
	});

	it('should succeed in PATCHing a null release version', async () => {
		await supertest(user)
			.patch(`/${version}/release(${release2.id})`)
			.send({
				release_version: null,
			})
			.expect(200);
	});

	it('should confirm that a new release can be created with version', async () => {
		topRevision = await getTopRevision(
			pineUser,
			fx.applications.app1.id,
			'0.0.0',
		);
		const { body } = await supertest(user)
			.post(`/${version}/release`)
			.send(newReleaseBody)
			.expect(201);
		expect(body).to.have.property(
			'release_version',
			newReleaseBody.release_version,
		);
		newRelease = body;
	});

	it('should mark it as final, assign the default semver and the next availale revision', async () => {
		const revision = topRevision + 1;
		expect(newRelease).to.have.property('semver', '0.0.0');
		expect(newRelease).to.have.property('revision', revision);
		expect(newRelease).to.have.property('is_final', true);

		const { body: freshlyGetRelease } = await pineUser
			.get({
				resource: 'release',
				id: newRelease.id,
				options: {
					$select: [
						'semver',
						'semver_major',
						'semver_minor',
						'semver_patch',
						'revision',
						'is_final',
					],
				},
			})
			.expect(200);
		expect(freshlyGetRelease).to.have.property('semver', '0.0.0');
		expect(freshlyGetRelease).to.have.property('semver_major', 0);
		expect(freshlyGetRelease).to.have.property('semver_minor', 0);
		expect(freshlyGetRelease).to.have.property('semver_patch', 0);
		expect(freshlyGetRelease).to.have.property('revision', revision);
		expect(freshlyGetRelease).to.have.property('is_final', true);
	});

	it('should disallow creating a new release with used version', async () => {
		await supertest(user)
			.post(`/${version}/release`)
			.send(newReleaseBody)
			.expect(400);
	});

	it('should confirm that invalidating a release allows reuse of version', async () => {
		await supertest(user)
			.patch(`/${version}/release(${release1.id})`)
			.send({
				is_invalidated: true,
			})
			.expect(200);
		await supertest(user)
			.patch(`/${version}/release(${release2.id})`)
			.send({
				release_version: release1.release_version,
			})
			.expect(200);
	});

	it('should start assigning new revisions per semver per app starting from 0', async () => {
		const newReleases: Release[] = [];
		// Add them in order so that they get predictable revisions.
		for (let i = 0; i < RELEASE_FINALIZATION_TEST_CONCURENCY; i++) {
			newReleases.push(
				(
					await pineUser
						.post({
							resource: 'release',
							body: {
								...newReleaseBody,
								commit: randomUUID(),
								release_version: undefined,
								semver: '0.2.0',
							},
						})
						.expect(201)
				).body as Release,
			);
		}

		newReleases.forEach((r) => expect(r).to.have.property('semver', '0.2.0'));
		newReleases.forEach((r) => expect(r).to.have.property('is_final', true));
		const newRevisions = newReleases.map((r) => r.revision);
		expect(newRevisions).to.deep.equal(_.range(0, newRevisions.length));
	});

	it('should assign unique revisions when multiple releases are created concurrently', async () => {
		topRevision = await getTopRevision(
			pineUser,
			fx.applications.app1.id,
			'0.0.0',
		);
		const newReleases = await Promise.all(
			_.times(RELEASE_FINALIZATION_TEST_CONCURENCY).map(async () => {
				await Bluebird.delay(
					Math.random() * RELEASE_FINALIZATION_CONCURENCY_DELAY_FACTOR,
				);
				return (
					await pineUser
						.post({
							resource: 'release',
							body: {
								...newReleaseBody,
								commit: randomUUID(),
								release_version: undefined,
								semver: '0.0.0',
							},
						})
						.expect(201)
				).body as Release;
			}),
		);

		newReleases.forEach((r) => {
			expect(r).to.have.property('semver', '0.0.0');
			expect(r).to.have.property('is_final', true);
		});
		const newRevisions = _.sortBy(
			newReleases.map((r) => r.revision),
			(rev) => rev,
		);
		expect(newRevisions).to.deep.equal(
			_.range(topRevision + 1, topRevision + 1 + newRevisions.length),
		);
	});

	const makeMarkAsFinalTest = (
		titlePart: string,
		updateFn: (newDraftReleases: Release[]) => Promise<void>,
	) => {
		it(`should assign unique revisions when multiple draft releases are marked as final ${titlePart}`, async () => {
			topRevision = await getTopRevision(
				pineUser,
				fx.applications.app1.id,
				'0.0.0',
			);
			const newDraftReleases = await Promise.all(
				_.times(RELEASE_FINALIZATION_TEST_CONCURENCY).map(async () => {
					return (
						await pineUser
							.post({
								resource: 'release',
								body: {
									...newReleaseBody,
									commit: randomUUID(),
									release_version: undefined,
									semver: '0.0.0',
									is_final: false,
								},
							})
							.expect(201)
					).body as Release;
				}),
			);
			newDraftReleases.forEach((r) =>
				expect(r).to.have.property('revision', null),
			);

			await updateFn(newDraftReleases);

			const { body: newFinalReleases } = await pineUser
				.get<Array<Pick<Release, 'revision'>>>({
					resource: 'release',
					options: {
						$select: 'revision',
						$filter: { id: { $in: newDraftReleases.map((r) => r.id) } },
					},
				})
				.expect(200);

			const newRevisions = _.sortBy(
				newFinalReleases.map((r) => r.revision),
				(rev) => rev,
			);
			expect(newRevisions).to.deep.equal(
				_.range(topRevision + 1, topRevision + 1 + newRevisions.length),
			);
		});
	};

	makeMarkAsFinalTest('with a single request', async (newDraftReleases) => {
		await pineUser
			.patch({
				resource: 'release',
				options: {
					$filter: { id: { $in: newDraftReleases.map((r) => r.id) } },
				},
				body: {
					is_final: true,
				},
			})
			.expect(200);
	});

	makeMarkAsFinalTest('concurrently', async (newDraftReleases) => {
		await Promise.all(
			newDraftReleases.map(async (r) => {
				await Bluebird.delay(
					Math.random() * RELEASE_FINALIZATION_CONCURENCY_DELAY_FACTOR,
				);
				await pineUser
					.patch({
						resource: 'release',
						id: r.id,
						body: {
							is_final: true,
						},
					})
					.expect(200);
			}),
		);
	});

	const makeUpdateSemverTest = (
		titlePart: string,
		[SEMVER_A, SEMVER_B]: [string, string],
		updateFn: (versionAReleasesToChangeSemver: Release[]) => Promise<void>,
	) => {
		it(`should assign the correct revisions when changing the semver of a release ${titlePart}`, async () => {
			const [v1Releases, v2Releases] = await Promise.all(
				[SEMVER_A, SEMVER_B].map(async (semver) => {
					const newReleases: Release[] = [];
					// Add them in order so that they get predictable revisions.
					for (let i = 0; i < RELEASE_FINALIZATION_TEST_CONCURENCY; i++) {
						newReleases.push(
							(
								await pineUser
									.post({
										resource: 'release',
										body: {
											...newReleaseBody,
											commit: randomUUID(),
											release_version: undefined,
											semver,
										},
									})
									.expect(201)
							).body as Release,
						);
					}

					const revisions = _.sortBy(
						newReleases.map((r) => r.revision),
						(rev) => rev,
					);
					expect(revisions).to.deep.equal(_.range(0, newReleases.length));
					return newReleases;
				}),
			);
			v1Releases
				.concat(v2Releases)
				.forEach((r) =>
					expect(r).to.have.property('revision').that.is.a('number'),
				);
			const [versionAReleasesToChangeSemver, [leftBehindV1SemverRelease]] =
				_.partition(
					v1Releases,
					(r) => v1Releases.indexOf(r) < v1Releases.length - 1,
				);
			const releaseIdsToChangeSemver = versionAReleasesToChangeSemver.map(
				(r) => r.id,
			);
			const maxV2Revision = Math.max(...v2Releases.map((r) => r.revision!));

			await updateFn(versionAReleasesToChangeSemver);

			const { body: changedSemverReleases } = await pineUser
				.get<Array<Pick<Release, 'revision'>>>({
					resource: 'release',
					options: {
						$select: 'revision',
						$filter: { id: { $in: releaseIdsToChangeSemver } },
					},
				})
				.expect(200);

			const newRevisions = _.sortBy(
				changedSemverReleases.map((r) => r.revision),
				(rev) => rev,
			);
			expect(newRevisions).to.deep.equal(
				_.range(maxV2Revision + 1, maxV2Revision + 1 + newRevisions.length),
			);

			const { body: unchangedV1SemverRelease } = await pineUser
				.get<Array<Pick<Release, 'revision'>>>({
					resource: 'release',
					id: leftBehindV1SemverRelease.id,
					options: {
						$select: ['semver', 'revision'],
					},
				})
				.expect(200);

			expect(unchangedV1SemverRelease).to.have.property('semver', SEMVER_A);
			expect(unchangedV1SemverRelease)
				.to.have.property('revision', leftBehindV1SemverRelease.revision)
				.that.equals(RELEASE_FINALIZATION_TEST_CONCURENCY - 1);
		});
	};

	makeUpdateSemverTest(
		'with a single request',
		['1.0.1', '2.0.1'],
		async (versionAReleasesToChangeSemver) => {
			const releaseIdsToChangeSemver = versionAReleasesToChangeSemver.map(
				(r) => r.id,
			);
			await pineUser
				.patch({
					resource: 'release',
					options: {
						$filter: { id: { $in: releaseIdsToChangeSemver } },
					},
					body: {
						semver: '2.0.1',
					},
				})
				.expect(200);
		},
	);

	makeUpdateSemverTest(
		'concurrently',
		['1.0.2', '2.0.2'],
		async (versionAReleasesToChangeSemver) => {
			await Promise.all(
				versionAReleasesToChangeSemver.map(async (r) => {
					await Bluebird.delay(
						Math.random() * RELEASE_FINALIZATION_CONCURENCY_DELAY_FACTOR,
					);
					await pineUser
						.patch({
							resource: 'release',
							id: r.id,
							body: {
								semver: '2.0.2',
							},
						})
						.expect(200);
				}),
			);
		},
	);
});

describe('draft releases', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let newRelease: AnyObject;
	let pineUser: typeof pineTest;

	before(async () => {
		fx = await fixtures.load('07-releases');
		user = fx.users.admin;
		pineUser = pineTest.clone({
			passthrough: { user },
		});
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('should be able to create a draft release', async () => {
		const { body } = await pineUser
			.post({
				resource: 'release',
				body: {
					belongs_to__application: fx.applications.app1.id,
					commit: 'test-commit',
					status: 'success',
					release_version: 'v10.1.1',
					composition: {},
					source: 'test',
					release_type: 'draft',
					start_timestamp: Date.now(),
				},
			})
			.expect(201);
		newRelease = body;
	});

	it('should return the release as not final and with a default semver', async () => {
		const { body } = await pineUser
			.get({
				resource: 'release',
				id: newRelease.id,
				options: {
					$select: ['is_final', 'revision', 'semver'],
				},
			})
			.expect(200);
		expect(body).to.have.property('is_final', false);
		expect(body).to.have.property('revision', null);
		expect(body).to.have.property('semver', '0.0.0');
	});

	it('should be able to mark it as final', async () => {
		await pineUser
			.patch({
				resource: 'release',
				id: newRelease.id,
				body: {
					release_type: 'final',
				},
			})
			.expect(200);
	});

	it('should then return the release as final and increase the revision', async () => {
		const { body } = await pineUser
			.get({
				resource: 'release',
				id: newRelease.id,
				options: {
					$select: ['is_final', 'revision', 'semver'],
				},
			})
			.expect(200);
		expect(body).to.have.property('is_final', true);
		expect(body).to.have.property('revision').that.is.greaterThanOrEqual(0);
	});

	it('should prevent changing a final relase back to draft', async () => {
		await pineUser
			.patch({
				resource: 'release',
				id: newRelease.id,
				body: {
					release_type: 'draft',
				},
			})
			.expect(400, '"Finalized releases cannot be converted to draft."');
	});
});
