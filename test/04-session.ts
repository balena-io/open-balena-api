import { expect } from 'chai';
import 'mocha';
import { app } from '../init';
import { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } from '../src/lib/config';
import { createScopedAccessToken } from '../src/platform/jwt';

import supertest = require('./test-lib/supertest');

describe('session', () => {
	before(async function() {
		this.token = (
			await supertest(app)
				.post('/login_')
				.send({
					username: SUPERUSER_EMAIL,
					password: SUPERUSER_PASSWORD,
				})
				.expect(200)
		).text;
	});

	it('/user/v1/whoami returns a user', async function() {
		const user = (
			await supertest(app, this.token)
				.get('/user/v1/whoami')
				.expect(200)
		).body;

		expect(user)
			.to.have.property('id')
			.that.is.a('number');
		expect(user.username).to.equal('admin');
		expect(user.email).to.equal(SUPERUSER_EMAIL);
	});

	it('/user/v1/whoami returns a user when using a correctly scoped access token', async function() {
		const record = (
			await supertest(app, this.token)
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
			await supertest(app, accessToken)
				.get('/user/v1/whoami')
				.expect(200)
		).body;

		expect(user)
			.to.have.property('id')
			.that.is.a('number');
		expect(user.username).to.equal('admin');
		expect(user.email).to.equal(SUPERUSER_EMAIL);
	});

	it('/user/v1/whoami returns a 401 error when using a scoped access token that does not have user permissions', async function() {
		const record = (
			await supertest(app, this.token)
				.get("/v5/user?$filter=username eq 'admin'")
				.expect(200)
		).body.d[0];

		const permissions = [
			'resin.application.get?belongs_to__user/any(u:u/eq @__ACTOR_ID)',
		];

		// Create a token that only has access to the granting users applications
		const accessToken = createScopedAccessToken({
			actor: record.actor,
			permissions,
			expiresIn: 60 * 10,
		});

		await supertest(app, accessToken)
			.get('/user/v1/whoami')
			.expect(401);
	});
});
