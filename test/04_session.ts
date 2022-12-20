import { expect } from 'chai';
import { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } from '../src/lib/config';
import { createScopedAccessToken } from '../src/infra/auth/jwt';

import * as fixtures from './test-lib/fixtures';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';

const atob = (x: string) => Buffer.from(x, 'base64').toString('binary');
const parseJwt = (t: string) => JSON.parse(atob(t.split('.')[1]));

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
				.get(`/${version}/user?$filter=username eq 'admin'`)
				.expect(200)
		).body.d[0];

		// Create a token that only has access to the granting users document
		const accessToken = createScopedAccessToken({
			actor: record.actor.__id,
			permissions: ['resin.user.read?actor eq @__ACTOR_ID'],
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
				.get(`/${version}/user?$filter=username eq 'admin'`)
				.expect(200)
		).body.d[0];

		const permissions = ['resin.application.read?actor eq @__ACTOR_ID'];

		// Create a token that only has access to the granting users applications
		const accessToken = createScopedAccessToken({
			actor: record.actor.__id,
			permissions,
			expiresIn: 60 * 10,
		});

		await supertest(accessToken).get('/user/v1/whoami').expect(401);
	});

	describe('granted user token', function () {
		let token: string;

		before(async function () {
			expect(admin).to.have.property('token').that.is.a('string');
			token = admin.token!;
		});

		it('should be refreshable with /user/v1/refresh-token', async function () {
			const res = await supertest({ token })
				.get('/user/v1/refresh-token')
				.expect(200);
			token = res.text;
			const tokenParts = token.split('.');
			expect(tokenParts).to.be.an('array');
			expect(tokenParts).to.have.property('length', 3);
			const payload = parseJwt(token);
			expect(payload).to.have.property('id');
			expect(payload).to.have.property('username');
			expect(payload).to.have.property('email');
		});

		it('should refresh & update the authTime with a POST to /user/v1/refresh-token using a correct password', async function () {
			let initialAuthTime: number;
			const res = await supertest(token)
				.get('/user/v1/refresh-token')
				.expect(200);

			token = res.text;
			const tokenParts = token.split('.');
			expect(tokenParts).to.be.an('array');
			expect(tokenParts).to.have.property('length', 3);
			const payload = parseJwt(token);
			expect(payload).to.have.property('id');
			expect(payload).to.have.property('username');
			expect(payload).to.have.property('email');
			expect(payload).to.have.property('authTime');
			initialAuthTime = payload.authTime;

			const res1 = await supertest(token)
				.post('/user/v1/refresh-token')
				.send({ password: SUPERUSER_PASSWORD })
				.expect(200);

			token = res1.text;
			const tokenParts1 = token.split('.');
			expect(tokenParts1).to.be.an('array');
			expect(tokenParts1).to.have.property('length', 3);
			const payload1 = parseJwt(token);
			expect(payload1).to.have.property('id');
			expect(payload1).to.have.property('username');
			expect(payload1).to.have.property('email');
			expect(payload1)
				.to.have.property('authTime')
				.to.be.above(initialAuthTime);
		});

		it('should not update the authTime with a POST to /user/v1/refresh-token w/o a password', async function () {
			let initialAuthTime: number;
			const res = await supertest(token)
				.get('/user/v1/refresh-token')
				.expect(200);
			token = res.text;
			const tokenParts = token.split('.');
			expect(tokenParts).to.be.an('array');
			expect(tokenParts).to.have.property('length', 3);
			const payload = parseJwt(token);
			expect(payload).to.have.property('id');
			expect(payload).to.have.property('username');
			expect(payload).to.have.property('email');
			expect(payload).to.have.property('authTime');
			initialAuthTime = payload.authTime;

			const res1 = await supertest(token)
				.post('/user/v1/refresh-token')
				.expect(200);
			token = res1.text;
			const tokenParts1 = token.split('.');
			expect(tokenParts1).to.be.an('array');
			expect(tokenParts1).to.have.property('length', 3);
			const payload1 = parseJwt(token);
			expect(payload1).to.have.property('id');
			expect(payload1).to.have.property('username');
			expect(payload1).to.have.property('email');
			expect(payload1)
				.to.have.property('authTime')
				.to.be.equal(initialAuthTime);
		});

		it('should not be refreshable with /user/v1/refresh-token and invalid password', async function () {
			await supertest(token)
				.post('/user/v1/refresh-token')
				.send({ password: 'invalidpass' })
				.expect(401);
		});
	});
});
