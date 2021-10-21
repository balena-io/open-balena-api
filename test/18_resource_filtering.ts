import { expect } from './test-lib/chai';
import * as Bluebird from 'bluebird';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import { pineTest } from './test-lib/pinetest';

import * as fixtures from './test-lib/fixtures';
import * as _ from 'lodash';
import { Application } from '../src/balena-model';

describe('Resource Filtering', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let testTimes: Array<Pick<Application, 'id' | 'created_at'>>;
	let pineUser: typeof pineTest;
	const applicationCount = 4;

	before(async () => {
		fx = await fixtures.load();
		user = fx.users.admin;
		pineUser = pineTest.clone({
			passthrough: {
				user,
			},
		});

		let response = await pineUser
			.get({
				resource: 'device_type',
				options: {
					$select: ['id'],
				},
			})
			.expect(200);

		// create couple of applications with ensuring different created_at timestamps
		for (let i = 0; i < applicationCount; i++) {
			await pineUser.post({
				resource: 'application',
				body: {
					app_name: `appapp${i}`,
					slug: `admin/test-app-${i}`,
					organization: 1,
					is_for__device_type: response.body[0].id,
				},
			});
			// console.log(JSON.stringify(resp.body, null, 2));
			await Bluebird.delay(100);
		}

		response = await pineUser
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

		testTimes = response.body;
	});

	after(async () => {
		await fixtures.clean(fx);
		await fixtures.clean(testTimes);
	});

	describe('Date field filters on created_at', () => {
		it('Should see all applications ', async () => {
			const { body } = await supertest(user)
				.get(`/${version}/application`)
				.expect(200);
			expect(body.d).to.be.an('array').to.have.lengthOf(applicationCount);
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
			const { body } = await pineUser.get({
				resource: 'application',
				options: {
					$filter: {
						created_at: { $le: testTimes[testTimes.length - 1].created_at },
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
			expect(_.find(body, { created_at: testTimes[0].created_at })).to.exist;
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
			expect(body.map((app: Application) => app.id)).to.not.include(
				testTimes[0].id,
			);
		});
	});
});
