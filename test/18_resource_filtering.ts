import { expect } from 'chai';
import type { UserObjectParam } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import * as fixtures from './test-lib/fixtures.js';
import _ from 'lodash';
import type { Application } from '../src/balena-model.js';
import { setTimeout } from 'timers/promises';
import type { PineTest } from 'pinejs-client-supertest';
import { assertExists, itExpectsError } from './test-lib/common.js';
import { provisionDevice } from './test-lib/fake-device.js';

export default () => {
	versions.test((version, pineTest) => {
		const isPinnedOnReleaseProp = versions.lt(version, 'v7')
			? 'should_be_running__release'
			: 'is_pinned_on__release';
		describe('Resource Filtering', () => {
			let fx: fixtures.Fixtures;
			let user: UserObjectParam;
			let testApps: Array<Pick<Application['Read'], 'id' | 'created_at'>>;
			let pineUser: PineTest;
			const applicationCount = 4;
			let device1: ResolvableReturnType<typeof provisionDevice>;
			let device2: ResolvableReturnType<typeof provisionDevice>;
			let device3: ResolvableReturnType<typeof provisionDevice>;

			before(async () => {
				fx = await fixtures.load('18-resource-filtering');
				user = fx.users.admin;
				const app0 = fx.applications.app0;
				pineUser = pineTest.clone({
					passthrough: {
						user,
					},
				});

				const { body: devicetype } = await pineUser
					.get({
						resource: 'device_type',
						id: { slug: 'intel-nuc' },
						options: {
							$select: ['id'],
						},
					})
					.expect(200);
				assertExists(devicetype);

				// create couple of applications with ensuring different created_at timestamps
				for (let i = 0; i < applicationCount; i++) {
					// The first app is created using fixtures so that we can easily create releases as well
					const { id: appId } =
						i === 0
							? app0
							: // The rest are created in code so that we can add some extra time between their creation dates
								(
									await pineUser.post({
										resource: 'application',
										body: {
											app_name: `appapp${i}`,
											organization: 1,
											is_for__device_type: devicetype.id,
										},
									})
								).body;

					await Promise.all(
						_.times(i + 1, async (tagNo) => {
							await pineUser.post({
								resource: 'application_tag',
								body: {
									application: appId,
									tag_key: `test-app-tag-${tagNo}`,
									value: `${tagNo % 2}`,
								},
							});
						}),
					);
					await setTimeout(100);
				}

				({ body: testApps } = await pineUser
					.get<Array<Pick<Application['Read'], 'id' | 'created_at'>>>({
						resource: 'application',
						options: {
							$select: ['id', 'created_at'],
							$orderby: {
								created_at: 'asc',
							},
						},
					})
					.expect(200));

				device1 = await provisionDevice(user, app0.id);
				await device1.patchStateV3({
					[device1.uuid]: {
						cpu_temp: 50,
					},
				});
				device2 = await provisionDevice(user, app0.id);
				await device2.patchStateV3({
					[device2.uuid]: {
						cpu_temp: 30,
					},
				});
				device3 = await provisionDevice(user, app0.id);

				const devicePropMap = {
					[device1.id]: {
						device_name: 'device1',
						[isPinnedOnReleaseProp]: fx.releases.release1.id,
					},
					[device2.id]: {
						device_name: 'device2',
						[isPinnedOnReleaseProp]: fx.releases.release2.id,
					},
					[device3.id]: {
						device_name: 'device3',
					},
				};

				for (const [id, body] of Object.entries(devicePropMap)) {
					await pineUser.patch({
						resource: 'device',
						id,
						body,
					});
				}
			});

			after(async () => {
				const fxAppIds = new Set(
					Object.values(fx.applications).map((a) => a.id),
				);
				await fixtures.clean(fx);
				await fixtures.clean({
					applications: Object.fromEntries(
						testApps.filter((a) => !fxAppIds.has(a.id)).map((a) => [a.id, a]),
					),
				});
			});

			describe('Integer field filters', function () {
				it('should be able to filter on metrics using integer values', async function () {
					const { body: hotDevices } = await pineUser
						.get({
							resource: 'device',
							options: {
								$select: 'uuid',
								$filter: {
									cpu_temp: { $gt: 37 },
								},
							},
						})
						.expect(200);
					expect(hotDevices.map((d) => d.uuid)).to.deep.equal([device1.uuid]);

					const { body: coolDevices } = await pineUser
						.get({
							resource: 'device',
							options: {
								$select: 'uuid',
								$filter: {
									cpu_temp: { $lt: 36 },
								},
							},
						})
						.expect(200);
					expect(coolDevices.map((d) => d.uuid)).to.deep.equal([device2.uuid]);
				});

				itExpectsError(
					'should be able to filter on metrics using decimal values',
					async function () {
						const { body: hotDevices } = await pineUser
							.get({
								resource: 'device',
								options: {
									$select: 'uuid',
									$filter: {
										cpu_temp: { $gt: 36.6 },
									},
								},
							})
							.expect(200);
						expect(hotDevices.map((d) => d.uuid)).to.deep.equal([device1.uuid]);

						const { body: coolDevices } = await pineUser
							.get({
								resource: 'device',
								options: {
									$select: 'uuid',
									$filter: {
										cpu_temp: { $lt: 36.6 },
									},
								},
							})
							.expect(200);
						expect(coolDevices.map((d) => d.uuid)).to.deep.equal([
							device2.uuid,
						]);
					},
					// DatabaseError: invalid input syntax for type integer: "36.6"`
					/expected 200 "OK", got 500 "Internal Server Error"/,
				);
			});

			describe('Date field filters on created_at', () => {
				it('Should see all applications ', async () => {
					const { body: apps } = await pineUser
						.get({
							resource: 'application',
							options: {
								$select: ['id', 'created_at'],
								$orderby: {
									created_at: 'asc',
								},
							},
						})
						.expect(200);
					expect(apps).to.be.an('array').to.have.lengthOf(applicationCount);
				});

				it('Should filter applications with created_at greater than first', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$filter: {
								created_at: { $gt: testApps[0].created_at },
							},
						},
					});
					expect(body)
						.to.be.an('array')
						.to.have.lengthOf(applicationCount - 1);
					expect(_.find(body, { created_at: testApps[0].created_at })).to.not
						.exist;
				});

				it('Should filter applications with created_at less or equal than last', async () => {
					const lastTestTime = testApps.at(-1);
					assertExists(lastTestTime);
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$filter: {
								created_at: { $le: lastTestTime.created_at },
							},
						},
					});

					expect(body).to.be.an('array').to.have.lengthOf(applicationCount);
				});

				it('Should filter applications with created_at equal first one', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$filter: {
								created_at: { $eq: testApps[0].created_at },
							},
						},
					});
					expect(_.find(body, { created_at: testApps[0].created_at })).to.exist;
				});

				it('Should filter applications with created_at not equal first one', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$filter: {
								created_at: { $ne: testApps[0].created_at },
							},
						},
					});
					expect(body)
						.to.be.an('array')
						.to.have.lengthOf(applicationCount - 1);
					expect(body.map((app) => app.id)).to.not.include(testApps[0].id);
				});
			});

			describe('Ordering by counts', () => {
				it('Should order applications by tag count', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$orderby: {
								application_tag: {
									$count: {},
								},
								$dir: 'desc',
							},
						},
					});
					expect(body).to.be.an('array').to.have.lengthOf(4);
					expect(body.map((app) => app.app_name)).deep.equal([
						'appapp3',
						'appapp2',
						'appapp1',
						'appapp0',
					]);
				});

				it('Should order applications by tag count using the deprecated raw string notation', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$orderby: { application_tag: { $count: {} }, $dir: 'desc' },
						},
					});
					expect(body).to.be.an('array').to.have.lengthOf(4);
					expect(body.map((app) => app.app_name)).deep.equal([
						'appapp3',
						'appapp2',
						'appapp1',
						'appapp0',
					]);
				});

				it('Should order applications by filtered tag count', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$select: 'app_name',
							$expand: { application_tag: {} },
							$orderby: [
								{
									application_tag: {
										$count: {
											$filter: {
												value: '0',
											},
										},
									},
									$dir: 'desc',
								},
								{
									app_name: 'asc',
								},
							],
						},
					} as const);
					expect(body).to.be.an('array').to.have.lengthOf(4);
					expect(body.map((app) => app.app_name)).deep.equal([
						'appapp2',
						'appapp3',
						'appapp0',
						'appapp1',
					]);
				});

				it('Should order applications by filtered tag count using the deprecated raw string notation', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$select: 'app_name',
							$expand: { application_tag: {} },
							$orderby: [
								{
									application_tag: { $count: { $filter: { value: '0' } } },
									$dir: 'desc',
								},
								{ app_name: 'asc' },
							],
						},
					} as const);
					expect(body).to.be.an('array').to.have.lengthOf(4);
					expect(body.map((app) => app.app_name)).deep.equal([
						'appapp2',
						'appapp3',
						'appapp0',
						'appapp1',
					]);
				});
			});

			describe('Ordering by fields of navigation resources', () => {
				it('should order pinned devices by the commit of their pinned release', async () => {
					const { body } = await pineUser.get({
						resource: 'device',
						options: {
							$select: 'device_name',
							$expand: {
								[isPinnedOnReleaseProp]: {
									$select: 'commit',
								},
							},
							$filter: {
								[isPinnedOnReleaseProp]: {
									$ne: null,
								},
							},
							$orderby: [`${isPinnedOnReleaseProp}/commit desc`],
						},
					});
					expect(
						body.map((d) => [
							d.device_name,
							d[isPinnedOnReleaseProp][0].commit,
						]),
					).deep.equal([
						['device1', 'deadc0de'],
						['device2', 'deadc0d3'],
					]);
				});

				it('should also include the unpinned devices when ordering by the commit of their pinned release', async () => {
					const { body } = await pineUser.get({
						resource: 'device',
						options: {
							$select: 'device_name',
							$expand: {
								[isPinnedOnReleaseProp]: {
									$select: 'commit',
								},
							},
							$orderby: [`${isPinnedOnReleaseProp}/commit desc`],
						},
					});
					expect(
						body.map((d) => [
							d.device_name,
							d[isPinnedOnReleaseProp][0]?.commit,
						]),
					).deep.equal([
						['device3', undefined],
						['device1', 'deadc0de'],
						['device2', 'deadc0d3'],
					]);
				});
			});
		});
	});
};
