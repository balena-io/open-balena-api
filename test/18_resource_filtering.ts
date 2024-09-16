import { expect } from 'chai';
import type { UserObjectParam } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import * as fixtures from './test-lib/fixtures.js';
import _ from 'lodash';
import type { Application } from '../src/balena-model.js';
import { setTimeout } from 'timers/promises';
import type { PineTest } from 'pinejs-client-supertest';
import { assertExists } from './test-lib/common.js';

export default () => {
	versions.test((_version, pineTest) => {
		describe('Resource Filtering', () => {
			let fx: fixtures.Fixtures;
			let user: UserObjectParam;
			let testTimes: Array<Pick<Application['Read'], 'id' | 'created_at'>>;
			let pineUser: PineTest;
			const applicationCount = 4;

			before(async () => {
				fx = await fixtures.load();
				user = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: {
						user,
					},
				});

				const {
					body: [devicetype],
				} = await pineUser
					.get({
						resource: 'device_type',
						options: {
							$select: ['id'],
						},
					})
					.expect(200);

				// create couple of applications with ensuring different created_at timestamps
				for (let i = 0; i < applicationCount; i++) {
					const {
						body: { id: appId },
					} = await pineUser.post({
						resource: 'application',
						body: {
							app_name: `appapp${i}`,
							slug: `admin/test-app-${i}`,
							organization: 1,
							is_for__device_type: devicetype.id,
						},
					});
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

				const { body: apps } = await pineUser
					.get<Array<Pick<Application['Read'], 'id' | 'created_at'>>>({
						resource: 'application',
						options: {
							$select: ['id', 'created_at'],
							$orderby: {
								created_at: 'asc',
							},
						},
					})
					.expect(200);

				testTimes = apps;
			});

			after(async () => {
				await fixtures.clean(fx);
				await fixtures.clean(testTimes);
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
								created_at: { $gt: testTimes[0].created_at },
							},
						},
					});
					expect(body)
						.to.be.an('array')
						.to.have.lengthOf(applicationCount - 1);
					expect(_.find(body, { created_at: testTimes[0].created_at })).to.not
						.exist;
				});

				it('Should filter applications with created_at less or equal than last', async () => {
					const lastTestTime = testTimes.at(-1);
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
								created_at: { $eq: testTimes[0].created_at },
							},
						},
					});
					expect(_.find(body, { created_at: testTimes[0].created_at })).to
						.exist;
				});

				it('Should filter applications with created_at not equal first one', async () => {
					const { body } = await pineUser.get({
						resource: 'application',
						options: {
							$filter: {
								created_at: { $ne: testTimes[0].created_at },
							},
						},
					});
					expect(body)
						.to.be.an('array')
						.to.have.lengthOf(applicationCount - 1);
					expect(body.map((app) => app.id)).to.not.include(testTimes[0].id);
				});

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
		});
	});
};
