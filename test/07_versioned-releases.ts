import { randomUUID } from 'node:crypto';
import _ from 'lodash';
import semverLib from 'semver';
import type { Release } from '../src/balena-model.js';
import { expectResourceToMatch } from './test-lib/api-helpers.js';
import * as fixtures from './test-lib/fixtures.js';
import { expect } from 'chai';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import { setTimeout } from 'timers/promises';
import { assertExists } from './test-lib/common.js';

export default () => {
	versions.test((version, pineTest) => {
		describe('releases', () => {
			let fx: fixtures.Fixtures;
			let user: UserObjectParam;
			let newRelease: AnyObject;
			let pineUser: typeof pineTest;

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
				pineUser = pineTest.clone({
					passthrough: { user },
				});
			});
			after(async () => {
				await fixtures.clean(fx);
			});

			const imageSizeType = versions.lte(version, 'v6') ? 'number' : 'string';
			it(`should return an image.image_size of type ${imageSizeType}`, async function () {
				const { body: image } = await pineUser
					.get({
						resource: 'image',
						id: fx.images.release1_image1.id,
						options: {
							$select: 'image_size',
						},
					})
					.expect(200);
				const imageSize = versions.lte(version, 'v6')
					? 75123123123
					: '75123123123';
				expect(image).to.have.property('image_size', imageSize);
			});

			it(`should be able to PATCH a ${imageSizeType} value < MAX_SAFE_INTEGER as an image.image_size`, async function () {
				const newSize = Number.MAX_SAFE_INTEGER - 1;
				const newSizeBodyValue = versions.lte(version, 'v6')
					? newSize
					: `${newSize}`;
				await pineUser
					.patch({
						resource: 'image',
						id: fx.images.release1_image1.id,
						body: {
							image_size: newSizeBodyValue.toString(),
						},
					})
					.expect(200);
				const { body: image } = await pineUser
					.get({
						resource: 'image',
						id: fx.images.release1_image1.id,
						options: {
							$select: 'image_size',
						},
					})
					.expect(200);
				expect(image).to.have.property('image_size', newSizeBodyValue);
			});

			it(`should be able to PATCH a value > MAX_SAFE_INTEGER as an image.image_size ${versions.lte(version, 'v6') ? 'but lose accuracy' : ''}`, async function () {
				const newBigIntSize = (
					BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10)
				).toString();
				expect(newBigIntSize).to.equal('9007199254741001'); // ~9 Petabytes
				await pineUser
					.patch({
						resource: 'image',
						id: fx.images.release1_image1.id,
						body: {
							image_size: newBigIntSize,
						},
					})
					.expect(200);
				const { body: image } = await pineUser
					.get({
						resource: 'image',
						id: fx.images.release1_image1.id,
						options: {
							$select: 'image_size',
						},
					})
					.expect(200);
				expect(image).to.have.property(
					'image_size',
					versions.lte(version, 'v6') ? 9007199254741000 : `9007199254741001`,
				);
			});

			it(`should be able to PATCH a the MAX BigInt value PostgreSQL supports (>> MAX_SAFE_INTEGER) as an image.image_size ${versions.lte(version, 'v6') ? 'but lose accuracy' : ''}`, async function () {
				const maxPgBigInt = (BigInt(2) ** BigInt(63) - BigInt(1)).toString();
				expect(maxPgBigInt).to.equal('9223372036854775807'); // ~9.2 Exabytes
				await pineUser
					.patch({
						resource: 'image',
						id: fx.images.release1_image1.id,
						body: {
							image_size: maxPgBigInt,
						},
					})
					.expect(200);
				const { body: image } = await pineUser
					.get({
						resource: 'image',
						id: fx.images.release1_image1.id,
						options: {
							$select: 'image_size',
						},
					})
					.expect(200);
				expect(image).to.have.property(
					'image_size',
					versions.lte(version, 'v6') ? 9223372036854776000 : maxPgBigInt,
				);
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

			it('should be able to update the known_issue_list_list of a release', async () => {
				await supertest(user)
					.patch(`/${version}/release(${fx.releases.release1.id})`)
					.send({
						known_issue_list: 'new issue description',
					})
					.expect(200);

				const {
					body: {
						d: [release],
					},
				} = await supertest(user).get(
					`/${version}/release(${fx.releases.release1.id})?$select=known_issue_list`,
				);
				expect(release).to.have.property(
					'known_issue_list',
					'new issue description',
				);
			});

			it('should be able to set the notes of a release', async () => {
				await expectResourceToMatch(
					pineUser,
					'release',
					fx.releases.release1.id,
					{
						note: null,
					},
				);

				await pineUser
					.patch({
						resource: 'release',
						id: fx.releases.release1.id,
						body: {
							note: 'This is a note!',
						},
					})
					.expect(200);

				await expectResourceToMatch(
					pineUser,
					'release',
					fx.releases.release1.id,
					{
						note: 'This is a note!',
					},
				);
			});

			it('should not be able to set an invalid value to the phase of a release', async () => {
				for (const phase of ['', 'my phase']) {
					await pineUser
						.patch({
							resource: 'release',
							id: fx.releases.release1.id,
							body: {
								phase,
							},
						})
						.expect(400);
				}

				await expectResourceToMatch(
					pineUser,
					'release',
					fx.releases.release1.id,
					{
						phase: null,
					},
				);
			});

			it('should be able to set the phase of a release to', async () => {
				for (const phase of ['next', 'current', 'sunset', 'end-of-life']) {
					await pineUser
						.patch({
							resource: 'release',
							id: fx.releases.release1.id,
							body: {
								phase,
							},
						})
						.expect(200);

					await expectResourceToMatch(
						pineUser,
						'release',
						fx.releases.release1.id,
						{
							phase,
						},
					);
				}
			});

			it('should be able to set the phase of a release to null', async () => {
				await pineUser
					.patch({
						resource: 'release',
						id: fx.releases.release1.id,
						body: {
							phase: null,
						},
					})
					.expect(200);

				await expectResourceToMatch(
					pineUser,
					'release',
					fx.releases.release1.id,
					{
						phase: null,
					},
				);
			});
		});

		const getTopRevision = async (
			pineTestInstance: typeof pineTest,
			appId: number,
			semver: string,
		) => {
			const semverObject = semverLib.parse(semver);
			assertExists(semverObject);
			const {
				body: [topRevisionRelease],
			} = await pineTestInstance
				.get<Array<Pick<Release['Read'], 'revision'>>>({
					resource: 'release',
					options: {
						$select: 'revision',
						$filter: {
							belongs_to__application: appId,
							semver_major: semverObject.major,
							semver_minor: semverObject.minor,
							semver_patch: semverObject.patch,
							semver_prerelease: semverObject.prerelease.join('.'),
							revision: { $ne: null },
						},
						$orderby: {
							revision: 'desc',
						},
					},
				})
				.expect(200);
			assertExists(topRevisionRelease.revision);
			expect(topRevisionRelease.revision).to.be.a('number');
			return topRevisionRelease.revision;
		};

		/* Tests that the computed terms have the correct values based on what values the DB fields hold. */
		const expectCorrectReleaseComputedTerms = (
			release: Release | AnyObject | undefined,
		) => {
			assertExists(release);
			const {
				revision,
				created_at,
				semver_major,
				semver_minor,
				semver_patch,
				semver_prerelease,
				semver_build,
				variant,
			} = release as Release['Read'];
			expect(release).to.have.deep.property('is_final', revision != null);

			const createdAtTimestamp = +new Date(created_at);
			const prerelease = [
				...(semver_prerelease.length > 0 ? semver_prerelease.split('.') : []),
				...(revision == null ? [createdAtTimestamp] : []),
			];

			const build = semver_build.length > 0 ? semver_build.split('.') : [];
			const rev =
				revision != null && revision > 0 ? `rev${revision}` : undefined;
			if (rev != null && !build.includes(rev)) {
				build.push(rev);
			}
			if (variant != null && variant !== '') {
				build.push(variant);
			}

			const semverCore = `${semver_major}.${semver_minor}.${semver_patch}`;
			const reconstructedUserProvidedSemver = `${semverCore}${
				semver_prerelease.length > 0 ? `-${semver_prerelease}` : ''
			}${semver_build.length > 0 ? `+${semver_build}` : ''}`;
			expect(release).to.have.deep.property(
				'semver',
				reconstructedUserProvidedSemver,
			);

			const rawVersion = `${semverCore}${
				prerelease.length > 0 ? `-${prerelease.join('.')}` : ''
			}${build.length > 0 ? `+${build.join('.')}` : ''}`;
			expect(release).to.have.deep.property('raw_version', rawVersion);

			const jsonVersion = {
				raw: rawVersion,
				major: semver_major,
				minor: semver_minor,
				patch: semver_patch,
				prerelease,
				build,
				version: `${semverCore}${
					prerelease.length > 0 ? `-${prerelease.join('.')}` : ''
				}`,
			};
			expect(release).to.have.deep.property('version', jsonVersion);
		};

		const releaseComputedTermsRequiredFields = [
			'semver',
			'semver_major',
			'semver_minor',
			'semver_patch',
			'semver_prerelease',
			'semver_build',
			'revision',
			'variant',
			'is_final',
			'created_at',
			'raw_version',
			'version',
		];

		const testCorrectReleaseComputedTerms = async (
			pineUser: typeof pineTest,
			releaseId: number,
		) => {
			const { body: release } = await pineUser
				.get<Release['Read']>({
					resource: 'release',
					id: releaseId,
					options: {
						$select: releaseComputedTermsRequiredFields,
					},
				})
				.expect(200);

			expectCorrectReleaseComputedTerms(release);
			return release;
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
			const testReleaseVersion = 'v10.1.1';

			async function testReleaseSemverPatch(opts: {
				initialSemver?: string;
				initialVariant?: string;
				semver?: string;
				variant?: string;
				shouldError: true;
			}): Promise<undefined>;
			async function testReleaseSemverPatch(opts: {
				initialSemver?: string;
				initialVariant?: string;
				semver?: string;
				variant?: string;
			}): Promise<Release['Read']>;
			async function testReleaseSemverPatch(opts: {
				initialSemver?: string;
				initialVariant?: string;
				semver?: string;
				variant?: string;
				shouldError?: boolean;
			}): Promise<Release['Read'] | undefined>;
			async function testReleaseSemverPatch({
				initialSemver = '0.0.1',
				initialVariant,
				shouldError = false,
				semver,
				variant,
			}: {
				initialSemver?: string;
				initialVariant?: string;
				semver?: string;
				variant?: string;
				shouldError?: boolean;
			}) {
				const { body: releasePostResult } = await pineUser
					.post({
						resource: 'release',
						body: {
							...newReleaseBody,
							commit: randomUUID(),
							semver: initialSemver,
							...(initialVariant != null && { variant: initialVariant }),
						},
					})
					.expect(201);

				expect(releasePostResult).to.have.property(
					'variant',
					initialVariant ?? '',
				);

				await pineUser
					.patch({
						resource: 'release',
						id: releasePostResult.id,
						body: {
							...(semver != null && { semver }),
							...(variant != null && { variant }),
						},
					})
					.expect(shouldError ? 400 : 200);
				if (shouldError) {
					return;
				}

				const release = await testCorrectReleaseComputedTerms(
					pineUser,
					releasePostResult.id,
				);
				expect(release).to.have.property('semver', semver ?? initialSemver);
				expect(release).to.have.property(
					'variant',
					variant ?? initialVariant ?? '',
				);
				return release;
			}

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
					expect(release)
						.to.have.property('release_version')
						.that.is.a('string');
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

			it('should succeed in PATCHing a release_version', async () => {
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

			it('should fail to PATCH a duplicate release_version', async () => {
				const releaseVersion = 'v1.2.3';
				await supertest(user)
					.patch(`/${version}/release(${release2.id})`)
					.send({
						release_version: releaseVersion,
					})
					.expect(400);
			});

			it('should succeed in PATCHing a null release_version', async () => {
				await supertest(user)
					.patch(`/${version}/release(${release2.id})`)
					.send({
						release_version: null,
					})
					.expect(200);
			});

			it('should confirm that a new release can be created with a release_version', async () => {
				topRevision = await getTopRevision(
					pineUser,
					fx.applications.app1.id,
					'0.0.0',
				);
				const { body } = await supertest(user)
					.post(`/${version}/release`)
					.send({
						...newReleaseBody,
						release_version: testReleaseVersion,
					})
					.expect(201);
				expect(body).to.have.property('release_version', testReleaseVersion);
				newRelease = body;
			});

			it('should mark it as final, assign the default semver and the next availale revision', async () => {
				const revision = topRevision + 1;
				expect(newRelease).to.have.property('semver', '0.0.0');
				expect(newRelease).to.have.property('semver_major', 0);
				expect(newRelease).to.have.property('semver_minor', 0);
				expect(newRelease).to.have.property('semver_patch', 0);
				expect(newRelease).to.have.property('semver_prerelease', '');
				expect(newRelease).to.have.property('semver_build', '');
				expect(newRelease).to.have.property('revision', revision);
				expect(newRelease).to.have.property('is_final', true);
				expect(newRelease)
					.to.have.property('is_finalized_at__date')
					.that.is.a('string');

				const { body: freshlyGetRelease } = await pineUser
					.get<Release['Read']>({
						resource: 'release',
						id: newRelease.id,
						options: {
							$select: [
								...releaseComputedTermsRequiredFields,
								'is_finalized_at__date',
							],
						},
					})
					.expect(200);
				expect(freshlyGetRelease).to.have.property('semver', '0.0.0');
				expect(freshlyGetRelease).to.have.property('semver_major', 0);
				expect(freshlyGetRelease).to.have.property('semver_minor', 0);
				expect(freshlyGetRelease).to.have.property('semver_patch', 0);
				expect(freshlyGetRelease).to.have.property('semver_prerelease', '');
				expect(freshlyGetRelease).to.have.property('semver_build', '');
				expect(freshlyGetRelease).to.have.property('revision', revision);
				expect(freshlyGetRelease).to.have.property('is_final', true);
				expect(freshlyGetRelease)
					.to.have.property('is_finalized_at__date')
					.that.is.a('string');
				expect(newRelease.is_finalized_at__date).to.equal(
					freshlyGetRelease.is_finalized_at__date,
				);
				expectCorrectReleaseComputedTerms(freshlyGetRelease);
			});

			it('should disallow creating a new release with used release_version', async () => {
				await supertest(user)
					.post(`/${version}/release`)
					.send({
						...newReleaseBody,
						release_version: testReleaseVersion,
					})
					.expect(400);
			});

			it('should confirm that invalidating a release allows reuse of a release_version', async () => {
				await supertest(user)
					.patch(`/${version}/release(${release1.id})`)
					.send({
						is_invalidated: true,
						invalidation_reason: 'For testing purposes.',
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
				const newReleases: Array<Release['Read']> = [];
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
										semver: '0.2.0',
									},
								})
								.expect(201)
						).body as Release['Read'],
					);
				}

				newReleases.forEach((r) =>
					expect(r).to.have.property('semver', '0.2.0'),
				);
				newReleases.forEach((r) =>
					expect(r).to.have.property('is_final', true),
				);
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
						await setTimeout(
							Math.random() * RELEASE_FINALIZATION_CONCURENCY_DELAY_FACTOR,
						);
						return (
							await pineUser
								.post({
									resource: 'release',
									body: {
										...newReleaseBody,
										commit: randomUUID(),
										semver: '0.0.0',
									},
								})
								.expect(201)
						).body as Release['Read'];
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
				updateFn: (newDraftReleases: Array<Release['Read']>) => Promise<void>,
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
											semver: '0.0.0',
											is_final: false,
										},
									})
									.expect(201)
							).body as Release['Read'];
						}),
					);
					newDraftReleases.forEach((r) =>
						expect(r).to.have.property('revision', null),
					);

					await updateFn(newDraftReleases);

					const { body: newFinalReleases } = await pineUser
						.get<Array<Pick<Release['Read'], 'revision'>>>({
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
						await setTimeout(
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
				updateFn: (
					versionAReleasesToChangeSemver: Array<Release['Read']>,
				) => Promise<void>,
			) => {
				it(`should assign the correct revisions when changing the semver of a release ${titlePart}`, async () => {
					const [v1Releases, v2Releases] = await Promise.all(
						[SEMVER_A, SEMVER_B].map(async (semver) => {
							const newReleases: Array<Release['Read']> = [];
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
													semver,
												},
											})
											.expect(201)
									).body as Release['Read'],
								);
							}

							newReleases.forEach(expectCorrectReleaseComputedTerms);

							const revisions = _.sortBy(
								newReleases.map((r) => r.revision),
								(rev) => rev,
							);
							expect(revisions).to.deep.equal(_.range(0, newReleases.length));
							for (const release of newReleases) {
								assertExists(release.revision);
								expect(release)
									.to.have.property('revision')
									.that.is.a('number');
							}
							return newReleases as Array<
								NonNullableField<Release['Read'], 'revision'>
							>;
						}),
					);
					const [versionAReleasesToChangeSemver, [leftBehindV1SemverRelease]] =
						_.partition(
							v1Releases,
							(r) => v1Releases.indexOf(r) < v1Releases.length - 1,
						);
					const releaseIdsToChangeSemver = versionAReleasesToChangeSemver.map(
						(r) => r.id,
					);
					const maxV2Revision = Math.max(...v2Releases.map((r) => r.revision));

					await updateFn(versionAReleasesToChangeSemver);

					const { body: changedSemverReleases } = await pineUser
						.get<Array<Pick<Release['Read'], 'revision'>>>({
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
						.get<Array<Pick<Release['Read'], 'revision'>>>({
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
							await setTimeout(
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

			[
				['1.2.3-beta1', 'beta1'],
				['1.2.3-beta.2', 'beta.2'],
				['1.2.3-beta2.fixed', 'beta2.fixed'],
			].forEach(([semver, prerelease]) => {
				it(`should support final releases with semvers including pre-release parts: ${semver}`, async () => {
					const { body: release } = await pineUser
						.post({
							resource: 'release',
							body: {
								...newReleaseBody,
								commit: randomUUID(),
								semver,
							},
						})
						.expect(201);
					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('revision', 0);
					expect(release).to.have.property('is_final', true);
					expect(release).to.have.property('raw_version', semver);
					expectCorrectReleaseComputedTerms(release);
				});
			});

			[
				['1.2.3-beta3', 'beta3'],
				['1.2.3-beta3.fixed', 'beta3.fixed'],
			].forEach(([semver, prerelease]) => {
				it(`should not increase the revision when the POSTed semver pre-release parts are different: ${semver}`, async () => {
					const { body: release } = await pineUser
						.post({
							resource: 'release',
							body: {
								...newReleaseBody,
								commit: randomUUID(),
								semver,
							},
						})
						.expect(201);
					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('revision', 0);
					expect(release).to.have.property('is_final', true);
					expect(release).to.have.property('raw_version', semver);
					expectCorrectReleaseComputedTerms(release);
				});
			});

			[
				['1.2.3-beta4', 'beta4'],
				['1.2.3-beta4.fixed', 'beta4.fixed'],
			].forEach(([semver, prerelease]) => {
				it(`should not increase the revision when the PACTHed semver pre-release parts are different: ${semver}`, async () => {
					const release = await testReleaseSemverPatch({
						semver,
					});
					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('revision', 0);
					expect(release).to.have.property('is_final', true);
					expect(release).to.have.property('raw_version', semver);
					expectCorrectReleaseComputedTerms(release);
				});
			});

			it(`should increase the revision when the POSTed semver & pre-release match`, async () => {
				const { body: release } = await pineUser
					.post({
						resource: 'release',
						body: {
							...newReleaseBody,
							commit: randomUUID(),
							semver: '1.2.3-beta3',
						},
					})
					.expect(201);
				expect(release).to.have.property('semver', '1.2.3-beta3');
				expect(release).to.have.property('revision', 1);
				expect(release).to.have.property('raw_version', '1.2.3-beta3+rev1');
				expectCorrectReleaseComputedTerms(release);
			});

			it(`should increase the revision when the PATCHed semver & pre-release match`, async () => {
				const release = await testReleaseSemverPatch({
					semver: '1.2.3-beta3',
				});
				expect(release).to.have.property('semver', '1.2.3-beta3');
				expect(release).to.have.property('revision', 2);
				expect(release).to.have.property('raw_version', '1.2.3-beta3+rev2');
				expectCorrectReleaseComputedTerms(release);
			});

			[
				['1.3.0+build1', 'build1'],
				['1.3.1+build.2', 'build.2'],
				['1.3.2+build2.fixed', 'build2.fixed'],
			].forEach(([semver, build]) => {
				it(`should support semvers with build metadata parts: ${semver}`, async () => {
					const { body: release } = await pineUser
						.post({
							resource: 'release',
							body: {
								...newReleaseBody,
								commit: randomUUID(),
								semver,
							},
						})
						.expect(201);
					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_build', build);
					expect(release).to.have.property('revision', 0);
					expectCorrectReleaseComputedTerms(release);
				});
			});

			[
				['1.2.3-beta1+build.otherpost', 'beta1', 'build.otherpost'],
				['1.3.0+build1', '', 'build1'], // same as above
				['1.3.1+build.2.otherpost', '', 'build.2.otherpost'],
			].forEach(([semver, prerelease, build]) => {
				it(`should increase the revision when the POSTed semver & pre-release match, regardless of the build ${semver}`, async () => {
					const { body: release } = await pineUser
						.post({
							resource: 'release',
							body: {
								...newReleaseBody,
								commit: randomUUID(),
								semver,
							},
						})
						.expect(201);
					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('semver_build', build);
					expect(release).to.have.property('revision', 1);
					expect(release).to.have.property('raw_version', `${semver}.rev1`);
					expectCorrectReleaseComputedTerms(release);
				});
			});

			[
				['1.2.3-beta1+build.otherpatch', 'beta1', 'build.otherpatch'],
				['1.3.0+build1', '', 'build1'], // same as above
				['1.3.1+build.2.otherpatch', '', 'build.2.otherpatch'],
			].forEach(([semver, prerelease, build]) => {
				it(`should increase the revision when the PATCHed semver & pre-release match, regardless of the build ${semver}`, async () => {
					const release = await testReleaseSemverPatch({
						semver,
					});
					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('semver_build', build);
					expect(release).to.have.property('revision', 2);
					expect(release).to.have.property('raw_version', `${semver}.rev2`);
				});
			});

			it(`should be able to create a new release with a variant`, async function () {
				const { body: release } = await pineUser
					.post({
						resource: 'release',
						body: {
							...newReleaseBody,
							commit: randomUUID(),
							semver: '1.0.0',
							variant: 'dev',
						},
					})
					.expect(201);

				expect(release).to.have.property('variant', 'dev');
				expect(release).to.have.property('revision', 0);
				expect(release).to.have.property('raw_version', '1.0.0+dev');

				const { body: releaseB } = await pineUser
					.post({
						resource: 'release',
						body: {
							...newReleaseBody,
							commit: randomUUID(),
							semver: '1.0.0',
							variant: 'dev',
						},
					})
					.expect(201);

				expect(releaseB).to.have.property('variant', 'dev');
				expect(releaseB).to.have.property('revision', 1);
				expect(releaseB).to.have.property('raw_version', '1.0.0+rev1.dev');
			});

			it(`should be able to update a release to a semver with a variant and pick the latest revision based for that variant`, async function () {
				const release = await testReleaseSemverPatch({
					initialSemver: '1.0.0',
					variant: 'dev',
				});
				expect(release).to.have.property('revision', 2);
				expect(release).to.have.property('raw_version', '1.0.0+rev2.dev');

				const releaseB = await testReleaseSemverPatch({
					initialSemver: '1.0.0',
					initialVariant: 'dev',
					variant: 'prod',
				});
				expect(releaseB).to.have.property('revision', 0);
				expect(releaseB).to.have.property('raw_version', '1.0.0+prod');
			});

			describe('user provided revN semver build metadata parts', function () {
				const getTestVersions = (versionCore: string) =>
					[
						[`${versionCore}+rev1`, 'rev1', 1, false],
						[`${versionCore}+rev0`, 'rev0', 0, true],
						[`${versionCore}+rev0`, 'rev0', 0, false],
						[`${versionCore}+rev100`, 'rev100', 100, false],
						[`${versionCore}+build100.rev100`, 'build100.rev100', 100, false],
						[`${versionCore}+rev100.build100`, 'rev100.build100', 100, false],
						[`${versionCore}+rev100.rev1`, 'rev100.rev1', 1, false],
						[`${versionCore}+rev1.rev100`, 'rev1.rev100', 1, false],
						[`${versionCore}+rev2`, 'rev2', 2, false],
						[`${versionCore}+rev3.prod`, 'rev3.prod', 3, false],
						[
							`${versionCore}+build4.rev4.rebuild2`,
							'build4.rev4.rebuild2',
							4,
							false,
						],
						[`${versionCore}+rev5`, 'rev5', 4, false],
						[`${versionCore}+rev1`, 'rev1', 1, true],
						[`${versionCore}+build2.rev2`, 'build2.rev2', 2, true],
						[`${versionCore}+rev3.prod`, 'rev3.prod', 3, true],
						[
							`${versionCore}+build4.rev4.rebuild2`,
							'build4.rev4.rebuild2',
							4,
							true,
						],
						[`${versionCore}+rev5`, 'rev5', 5, true],
					] as const;

				describe('POST', function () {
					getTestVersions('1.4.0').forEach(
						([semver, build, resultingRevision, success]) => {
							it(`should ${success ? '' : 'not '}succeed when ${
								success ? '' : 'not '
							}matching the generated revision: ${semver}`, async () => {
								const { body: release } = await pineUser
									.post({
										resource: 'release',
										body: {
											...newReleaseBody,
											commit: randomUUID(),
											semver,
										},
									})
									.expect(success ? 201 : 400);

								if (!success) {
									return;
								}
								expect(release).to.have.property('semver', semver);
								expect(release).to.have.property('semver_build', build);
								expect(release).to.have.property('revision', resultingRevision);
								expectCorrectReleaseComputedTerms(release);
							});
						},
					);
				});

				describe('PATCH', function () {
					getTestVersions('1.5.0').forEach(
						([semver, build, resultingRevision, success]) => {
							it(`should ${success ? '' : 'not '}succeed when ${
								success ? '' : 'not '
							}matching the generated revision: ${semver}`, async () => {
								const release = await testReleaseSemverPatch({
									initialSemver: '0.0.1-beta1+prod',
									semver,
									shouldError: !success,
								});
								if (!success) {
									return;
								}
								expect(release).to.have.property('semver_build', build);
								expect(release).to.have.property('revision', resultingRevision);
							});
						},
					);

					it(`should not succeed PATCHing more than one release to the same revN semver`, async () => {
						const releases = await Promise.all(
							_.range(2).map(async () => {
								const { body: releasePostResult } = await pineUser
									.post({
										resource: 'release',
										body: {
											...newReleaseBody,
											commit: randomUUID(),
										},
									})
									.expect(201);
								return releasePostResult;
							}),
						);
						await pineUser
							.patch({
								resource: 'release',
								options: {
									$filter: {
										id: { $in: releases.map((r) => r.id) },
									},
								},
								body: {
									semver: '1.6.0+rev0',
								},
							})
							.expect(
								400,
								'"The provided revision does not match the autogenerated one."',
							);
					});
				});
			});

			describe('user provided revN semver build metadata & variant', function () {
				/**
				 * When a user creates/updates a release that has a (user provided) semver_build that includes a revN part,
				 * the request should only succeed iff the (user provided) revN part matches the auto-incremented release.revision that the API will auto-generate.
				 */
				const testVersions = [
					// versions with variants
					[`2.88.4+rev1`, 'prod', 'rev1', 1, false], // fails b/c the auto-generated revision will be 0
					[`2.88.4+rev0`, 'prod', 'rev0', 0, '2.88.4+rev0.prod'],
					[`2.88.4+rev0`, 'prod', 'rev0', 0, false], // fails b/c the auto-generated revision will be 1
					[`2.88.4+rev1`, 'prod', 'rev1', 1, '2.88.4+rev1.prod'],
					[`2.88.4+rev1`, 'dev', 'rev1', 1, false], // fails b/c the auto-generated revision will be 0
					[`2.88.4+rev0`, 'dev', 'rev0', 0, '2.88.4+rev0.dev'],
					[`2.88.4+rev1`, 'dev', 'rev1', 1, '2.88.4+rev1.dev'],
					[`2.88.4+rev1`, 'prod', 'rev1', 1, false], // fails b/c the auto-generated revision will be 2
					[`2.88.4+rev1`, 'dev', 'rev1', 1, false], // fails b/c the auto-generated revision will be 2
					[`2.88.4+rev2`, 'prod', 'rev2', 2, '2.88.4+rev2.prod'],
					[`2.88.4+rev2`, 'dev', 'rev2', 2, '2.88.4+rev2.dev'],
					// unified versions
					[`2.94.4+rev1`, undefined, 'rev1', 1, false], // fails b/c the auto-generated revision will be 0
					[`2.94.4`, undefined, '', 0, true],
					[`2.94.4+rev2`, undefined, 'rev2', 2, false], // fails b/c the auto-generated revision will be 1
					[`2.94.4+rev1`, undefined, 'rev1', 1, true],
					[`2.94.4+rev2`, undefined, 'rev2', 2, true],
					// 😈 cases
					['8.8.0', undefined, '', 0, '8.8.0'],
					['8.8.0', 'prod', '', 0, '8.8.0+prod'],
					['8.8.0', undefined, '', 1, '8.8.0+rev1'],
					['8.8.0', 'prod', '', 1, '8.8.0+rev1.prod'],
					['8.8.1-123.pre+asdf.qwerty', undefined, 'asdf.qwerty', 0, true],
					[
						'8.8.1-123.pre+asdf.qwerty',
						'prod',
						'asdf.qwerty',
						0,
						'8.8.1-123.pre+asdf.qwerty.prod',
					],
					[
						'8.8.1-123.pre+asdf.qwerty',
						undefined,
						'asdf.qwerty',
						1,
						'8.8.1-123.pre+asdf.qwerty.rev1',
					],
					[
						'8.8.1-123.pre+asdf.qwerty',
						'prod',
						'asdf.qwerty',
						1,
						'8.8.1-123.pre+asdf.qwerty.rev1.prod',
					],
					[
						'8.8.1-123.pre+asdf.rev2.qwerty',
						undefined,
						'asdf.rev2.qwerty',
						2,
						true,
					],
					[
						'8.8.1-123.pre+asdf.rev2.qwerty',
						'prod',
						'asdf.rev2.qwerty',
						2,
						'8.8.1-123.pre+asdf.rev2.qwerty.prod',
					],
					[
						'8.8.2-123.pre+asdf.rev0.qwerty',
						undefined,
						'asdf.rev0.qwerty',
						0,
						true,
					],
					[
						'8.8.2-123.pre+asdf.rev0.qwerty',
						'prod',
						'asdf.rev0.qwerty',
						0,
						'8.8.2-123.pre+asdf.rev0.qwerty.prod',
					],
				] as const;

				describe('POST', function () {
					const releaseIds: number[] = [];
					after(async function () {
						await pineUser
							.patch({
								resource: 'application',
								id: newReleaseBody.belongs_to__application,
								body: {
									should_be_running__release: null,
								},
							})
							.expect(200);

						await pineUser
							.delete({
								resource: 'release',
								options: {
									$filter: {
										id: { $in: releaseIds },
									},
								},
							})
							.expect(200);
					});

					testVersions.forEach(
						([
							semver,
							variant,
							build,
							resultingRevision,
							successOrRawVersion,
						]) => {
							const success = !!successOrRawVersion;
							it(`should ${
								success ? '' : 'not '
							}succeed: ${semver} ${variant}`, async () => {
								const { body: release } = await pineUser
									.post({
										resource: 'release',
										body: {
											...newReleaseBody,
											commit: randomUUID(),
											semver,
											...(variant != null && { variant }),
										},
									})
									.expect(success ? 201 : 400);

								if (!success) {
									return;
								}
								releaseIds.push(release.id);
								expect(release).to.have.property('semver_build', build);
								expect(release).to.have.property('revision', resultingRevision);
								expect(release).to.have.property('variant', variant ?? '');
								expect(release).to.have.property(
									'raw_version',
									successOrRawVersion === true ? semver : successOrRawVersion,
								);
								expectCorrectReleaseComputedTerms(release);
							});
						},
					);
				});

				describe('PATCH', function () {
					testVersions.forEach(
						([
							semver,
							variant,
							build,
							resultingRevision,
							successOrRawVersion,
						]) => {
							const success = !!successOrRawVersion;
							it(`should ${
								success ? '' : 'not '
							}succeed: ${semver} ${variant}`, async () => {
								const release = await testReleaseSemverPatch({
									initialSemver: '0.0.1-beta1+prod',
									semver,
									variant,
									shouldError: !success,
								});
								if (!success) {
									return;
								}
								expect(release).to.have.property('semver_build', build);
								expect(release).to.have.property('revision', resultingRevision);
								expect(release).to.have.property('variant', variant ?? '');
								expect(release).to.have.property(
									'raw_version',
									successOrRawVersion === true ? semver : successOrRawVersion,
								);
							});
						},
					);
				});
			});
		});

		describe('draft releases', () => {
			let fx: fixtures.Fixtures;
			let user: UserObjectParam;
			let newReleaseBody: AnyObject;
			const testReleaseVersion = 'v10.1.1';
			let newRelease: AnyObject;
			let pineUser: typeof pineTest;

			before(async () => {
				fx = await fixtures.load('07-releases');
				user = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: { user },
				});
				newReleaseBody = {
					belongs_to__application: fx.applications.app1.id,
					commit: 'test-commit',
					status: 'success',
					composition: {},
					source: 'test',
					is_final: false,
					start_timestamp: Date.now(),
				};
			});

			after(async () => {
				await fixtures.clean(fx);
			});

			it('should be able to create a draft release', async () => {
				const { body } = await pineUser
					.post({
						resource: 'release',
						body: {
							...newReleaseBody,
							release_version: testReleaseVersion,
						},
					})
					.expect(201);
				newRelease = body;
			});

			it('should mark it as non-final, assign the default semver and keep the revision null', async () => {
				expect(newRelease).to.have.property('semver', '0.0.0');
				expect(newRelease).to.have.property('revision', null);
				expect(newRelease).to.have.property('is_final', false);

				const { body: freshlyGetRelease } = await pineUser
					.get({
						resource: 'release',
						id: newRelease.id,
						options: {
							$select: releaseComputedTermsRequiredFields,
						},
					})
					.expect(200);
				expect(freshlyGetRelease).to.have.property('semver', '0.0.0');
				expect(freshlyGetRelease).to.have.property('semver_major', 0);
				expect(freshlyGetRelease).to.have.property('semver_minor', 0);
				expect(freshlyGetRelease).to.have.property('semver_patch', 0);
				expect(freshlyGetRelease).to.have.property('semver_prerelease', '');
				expect(freshlyGetRelease).to.have.property('semver_build', '');
				expect(freshlyGetRelease).to.have.property('revision', null);
				expect(freshlyGetRelease).to.have.property('is_final', false);
				expectCorrectReleaseComputedTerms(freshlyGetRelease);
			});

			it('should return the release as not final and with a default semver', async () => {
				const { body } = await pineUser
					.get({
						resource: 'release',
						id: newRelease.id,
						options: {
							$select: [
								'is_final',
								'is_finalized_at__date',
								'revision',
								'semver',
							],
						},
					})
					.expect(200);
				expect(body).to.have.property('is_final', false);
				expect(body).to.have.property('is_finalized_at__date', null);
				expect(body).to.have.property('revision', null);
				expect(body).to.have.property('semver', '0.0.0');
			});

			it('should be able to mark it as final', async () => {
				await pineUser
					.patch({
						resource: 'release',
						id: newRelease.id,
						body: {
							is_final: true,
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
							is_final: false,
						},
					})
					.expect(400, '"Finalized releases cannot be converted to draft."');
			});

			(
				[
					['1.2.3-beta1', 'beta1'],
					['1.2.3-beta1', 'beta1', 'dev'],
				] as const
			).forEach(([semver, prerelease, variant]) => {
				let release: AnyObject;
				it(`should support draft releases with semver pre-release parts: ${semver} ${
					variant ?? ''
				}`, async () => {
					release = (
						await pineUser
							.post({
								resource: 'release',
								body: {
									...newReleaseBody,
									commit: randomUUID(),
									semver,
									...(variant != null && { variant }),
									is_final: false,
								},
							})
							.expect(201)
					).body;

					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('variant', variant ?? '');
					expect(release).to.have.property('revision', null);
					expect(release).to.have.property('is_final', false);
					expect(release).to.have.property(
						'raw_version',
						`${semver}.${+new Date(release.created_at)}${
							variant != null ? `+${variant}` : ''
						}`,
					);
					expectCorrectReleaseComputedTerms(release);
				});

				it(`should be able to finalize draft releases with semver pre-release parts: ${semver} ${
					variant ?? ''
				}`, async () => {
					await pineUser
						.patch({
							resource: 'release',
							id: release.id,
							body: {
								is_final: true,
							},
						})
						.expect(200);
					const { body: updatedRelease } = await pineUser
						.get({
							resource: 'release',
							id: release.id,
							options: {
								$select: releaseComputedTermsRequiredFields,
							},
						})
						.expect(200);

					expect(updatedRelease).to.have.property('semver', semver);
					expect(updatedRelease).to.have.property(
						'semver_prerelease',
						prerelease,
					);
					expect(updatedRelease).to.have.property('variant', variant ?? '');
					expect(updatedRelease).to.have.property('revision', 0);
					expect(updatedRelease).to.have.property('is_final', true);
					expect(updatedRelease).to.have.property(
						'raw_version',
						`${semver}${variant != null ? `+${variant}` : ''}`,
					);
					expectCorrectReleaseComputedTerms(updatedRelease);
				});
			});

			[
				['1.2.3+build1', '', 'build1', 0],
				['1.2.3+build2', '', 'build2', 1],
				['1.2.4-beta1+build1', 'beta1', 'build1', 0],
			].forEach(([semver, prerelease, build, resultingRevision]) => {
				let release: AnyObject;
				it(`should support draft releases with semver build metadata parts: ${semver}`, async () => {
					release = (
						await pineUser
							.post({
								resource: 'release',
								body: {
									...newReleaseBody,
									commit: randomUUID(),
									semver,
									is_final: false,
								},
							})
							.expect(201)
					).body;

					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_prerelease', prerelease);
					expect(release).to.have.property('semver_build', build);
					expect(release).to.have.property('revision', null);
					expect(release).to.have.property('is_final', false);
					expectCorrectReleaseComputedTerms(release);
				});

				it(`should be able to finalize draft releases with semver build metadata parts: ${semver}`, async () => {
					await pineUser
						.patch({
							resource: 'release',
							id: release.id,
							body: {
								is_final: true,
							},
						})
						.expect(200);
					const { body: updatedRelease } = await pineUser
						.get({
							resource: 'release',
							id: release.id,
							options: {
								$select: releaseComputedTermsRequiredFields,
							},
						})
						.expect(200);

					expect(updatedRelease).to.have.property('semver', semver);
					expect(updatedRelease).to.have.property('semver_build', build);
					expect(updatedRelease).to.have.property(
						'revision',
						resultingRevision,
					);
					expect(updatedRelease).to.have.property('is_final', true);
					expectCorrectReleaseComputedTerms(updatedRelease);
				});
			});

			[
				['1.2.3+rev1', 'rev1', 1, false], // fails b/c the auto-generated revision will be 2
				['1.2.3+build1.rev1', 'build1.rev1', 1, false], // fails b/c the auto-generated revision will be 2
				['1.2.3+rev1.build1', 'rev1.build1', 1, false], // fails b/c the auto-generated revision will be 2
				['1.2.3+rev2', 'rev2', 2, true],
				['1.2.3+build3.rev4', 'build3.rev4', 4, false], // fails b/c the auto-generated revision will be 3
				['1.2.3+build3.rev3', 'build3.rev3', 3, true],
				['1.2.3+rev4.build4', 'rev4.build4', 4, true],
				['1.2.4+rev0', 'rev0', 0, true],
			].forEach(([semver, build, resultingRevision, canFinalize]) => {
				let release: AnyObject;
				it(`should support draft releases with user provided revN semver build metadata parts: ${semver}`, async () => {
					release = (
						await pineUser
							.post({
								resource: 'release',
								body: {
									...newReleaseBody,
									commit: randomUUID(),
									semver,
									is_final: false,
								},
							})
							.expect(201)
					).body;

					expect(release).to.have.property('semver', semver);
					expect(release).to.have.property('semver_build', build);
					expect(release).to.have.property('revision', null);
					expect(release).to.have.property('is_final', false);
					expectCorrectReleaseComputedTerms(release);
				});

				/**
				 * When a user finalizes a draft release that has a (user provided) semver_build that includes a revN part,
				 * the request should only succeed iff the (user provided) revN part matches the auto-incremented release.revision that the API will auto-generate.
				 */
				if (!canFinalize) {
					it(`should not be able to finalize draft releases with user provided revN semver build metadata parts when the generated revision is different: ${semver}`, async () => {
						await pineUser
							.patch({
								resource: 'release',
								id: release.id,
								body: {
									is_final: true,
								},
							})
							.expect(400);
					});
				} else {
					it(`should be able to finalize draft releases with user provided revN semver build metadata parts iff the generated revision matches: ${semver}`, async () => {
						await pineUser
							.patch({
								resource: 'release',
								id: release.id,
								body: {
									is_final: true,
								},
							})
							.expect(200);
						const { body: updatedRelease } = await pineUser
							.get({
								resource: 'release',
								id: release.id,
								options: {
									$select: releaseComputedTermsRequiredFields,
								},
							})
							.expect(200);

						expect(updatedRelease).to.have.property('semver', semver);
						expect(updatedRelease).to.have.property('semver_build', build);
						expect(updatedRelease).to.have.property(
							'revision',
							resultingRevision,
						);
						expect(updatedRelease).to.have.property('is_final', true);
						expectCorrectReleaseComputedTerms(updatedRelease);
					});
				}
			});
		});
	});
};
