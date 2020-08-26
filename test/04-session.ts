import { expect } from 'chai';
import { SUPERUSER_EMAIL } from '../src/lib/config';
import { createScopedAccessToken } from '../src/infra/auth/jwt';

import * as fixtures from './test-lib/fixtures';
import { supertest, UserObjectParam } from './test-lib/supertest';

describe('session', () => {
	let admin: UserObjectParam;

	before(async function () {
		const fx = await fixtures.load();
		admin = fx.users.admin;
	});

	it('/user/v1/whoami returns a user', async function () {
		const user = (await supertest(admin).get('/user/v1/whoami').expect(200))
			.body;

		expect(user).to.have.property('id').that.is.a('number');
		expect(user.username).to.equal('admin');
		expect(user.email).to.equal(SUPERUSER_EMAIL);
	});

	it('/user/v1/whoami returns a user when using a correctly scoped access token', async function () {
		const record = (
			await supertest(admin)
				.get("/v5/user?$filter=username eq 'admin'")
				.expect(200)
		).body.d[0];

		// Create a token that only has access to the granting users document
		const accessToken = createScopedAccessToken({
			actor: record.actor,
			permissions: ['resin.user.get?actor eq @__ACTOR_ID'],
			expiresIn: 60 * 10,
		});

		const user = (
			await supertest(accessToken).get('/user/v1/whoami').expect(200)
		).body;

		expect(user).to.have.property('id').that.is.a('number');
		expect(user.username).to.equal('admin');
		expect(user.email).to.equal(SUPERUSER_EMAIL);
	});

	it('/user/v1/whoami returns a 401 error when using a scoped access token that does not have user permissions', async function () {
		const record = (
			await supertest(admin)
				.get("/v5/user?$filter=username eq 'admin'")
				.expect(200)
		).body.d[0];

		const permissions = ['resin.application.get?actor eq @__ACTOR_ID'];

		// Create a token that only has access to the granting users applications
		const accessToken = createScopedAccessToken({
			actor: record.actor,
			permissions,
			expiresIn: 60 * 10,
		});

		await supertest(accessToken).get('/user/v1/whoami').expect(401);
	});
});
