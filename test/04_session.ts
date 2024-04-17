import { expect } from 'chai';
import { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } from '../src/lib/config.js';
import { createScopedAccessToken } from '../src/infra/auth/jwt.js';

import * as fixtures from './test-lib/fixtures.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import type { Device } from './test-lib/fake-device.js';
import type { Application } from '../src/balena-model.js';

const atob = (x: string) => Buffer.from(x, 'base64').toString('binary');
const parseJwt = (t: string) => JSON.parse(atob(t.split('.')[1]));

export default () => {
	versions.test((version) => {
		describe('session', () => {
			let admin: UserObjectParam;
			let device: Device;
			let application: Application['Read'];
			let deviceApiKey: string;
			let provisioningKey: string;
			let userApiKey: string;

			before(async function () {
				const fx = await fixtures.load('04-session');
				this.loadedFixtures = fx;
				admin = fx.users.admin;
				device = fx.devices.device1;
				application = fx.applications.app1;

				const { body: deviceKeyBody } = await supertest(admin).post(
					`/api-key/device/${device.id}/device-key`,
				);
				deviceApiKey = deviceKeyBody;

				const { body: appKeyBody } = await supertest(admin).post(
					`/api-key/application/${application.id}/provisioning`,
				);
				provisioningKey = appKeyBody;

				const { body: userKeyBody } = await supertest(admin)
					.post('/api-key/user/full')
					.send({ name: 'actorwhoamitest' });

				userApiKey = userKeyBody;
			});

			after(async function () {
				await supertest(admin).delete(`/${version}/api_key`).expect(200);
				await fixtures.clean(this.loadedFixtures);
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

				const actor = versions.gt(version, 'v6')
					? record.actor.__id
					: record.actor;

				// Create a token that only has access to the granting users document
				const accessToken = createScopedAccessToken({
					actor,
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

				const actor = versions.gt(version, 'v6')
					? record.actor.__id
					: record.actor;
				const permissions = ['resin.application.read?actor eq @__ACTOR_ID'];

				// Create a token that only has access to the granting users applications
				const accessToken = createScopedAccessToken({
					actor,
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
					expect(payload).to.not.have.property('username');
					expect(payload).to.not.have.property('email');
				});

				it('should refresh & update the authTime with a POST to /user/v1/refresh-token using a correct password', async function () {
					const res = await supertest(token)
						.get('/user/v1/refresh-token')
						.expect(200);

					token = res.text;
					const tokenParts = token.split('.');
					expect(tokenParts).to.be.an('array');
					expect(tokenParts).to.have.property('length', 3);
					const payload = parseJwt(token);
					expect(payload).to.have.property('id');
					expect(payload).to.not.have.property('username');
					expect(payload).to.not.have.property('email');
					expect(payload).to.have.property('authTime');
					const initialAuthTime: number = payload.authTime;

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
					expect(payload1).to.not.have.property('username');
					expect(payload1).to.not.have.property('email');
					expect(payload1)
						.to.have.property('authTime')
						.to.be.above(initialAuthTime);
				});

				it('should not update the authTime with a POST to /user/v1/refresh-token w/o a password', async function () {
					const res = await supertest(token)
						.get('/user/v1/refresh-token')
						.expect(200);
					token = res.text;
					const tokenParts = token.split('.');
					expect(tokenParts).to.be.an('array');
					expect(tokenParts).to.have.property('length', 3);
					const payload = parseJwt(token);
					expect(payload).to.have.property('id');
					expect(payload).to.not.have.property('username');
					expect(payload).to.not.have.property('email');
					expect(payload).to.have.property('authTime');
					const initialAuthTime: number = payload.authTime;

					const res1 = await supertest(token)
						.post('/user/v1/refresh-token')
						.expect(200);
					token = res1.text;
					const tokenParts1 = token.split('.');
					expect(tokenParts1).to.be.an('array');
					expect(tokenParts1).to.have.property('length', 3);
					const payload1 = parseJwt(token);
					expect(payload1).to.have.property('id');
					expect(payload1).to.not.have.property('username');
					expect(payload1).to.not.have.property('email');
					expect(payload1)
						.to.have.property('authTime')
						.that.equals(initialAuthTime);
				});

				it('should not be refreshable with /user/v1/refresh-token and invalid password', async function () {
					await supertest(token)
						.post('/user/v1/refresh-token')
						.send({ password: 'invalidpass' })
						.expect(401);
				});
			});

			it('/actor/v1/whoami returns an actor for an user token', async function () {
				const userActor = (
					await supertest(admin).get('/actor/v1/whoami').expect(200)
				).body;

				expect(userActor).to.have.property('id').that.is.a('number');
				expect(userActor.actorType).to.equal('user');
				expect(userActor.actorTypeId).to.equal(admin.id);
				expect(userActor.username).to.equal('admin');
				expect(userActor.email).to.equal(SUPERUSER_EMAIL);
			});

			it('/actor/v1/whoami returns an actor for an user api key', async function () {
				const userActor = (
					await supertest(userApiKey).get('/actor/v1/whoami').expect(200)
				).body;

				expect(userActor).to.have.property('id').that.is.a('number');
				expect(userActor.actorType).to.equal('user');
				expect(userActor.actorTypeId).to.equal(admin.id);
				expect(userActor.username).to.equal('admin');
				expect(userActor.email).to.equal(SUPERUSER_EMAIL);
			});

			it('/actor/v1/whoami returns an actor for a device api key', async function () {
				const deviceActor = (
					await supertest(deviceApiKey).get('/actor/v1/whoami').expect(200)
				).body;

				expect(deviceActor).to.have.property('id').that.is.a('number');
				expect(deviceActor.actorType).to.equal('device');
				expect(deviceActor.actorTypeId).to.equal(device.id);
				expect(deviceActor.uuid).to.equal(device.uuid);
			});

			it('/actor/v1/whoami returns an actor for an application api key', async function () {
				const appActor = (
					await supertest(provisioningKey).get('/actor/v1/whoami').expect(200)
				).body;

				expect(appActor).to.have.property('id').that.is.a('number');
				expect(appActor.actorType).to.equal('application');
				expect(appActor.actorTypeId).to.equal(application.id);
				expect(appActor.slug).to.equal(application.slug);
			});

			it('/actor/v1/whoami returns a user when using a correctly scoped access token', async function () {
				const record = (
					await supertest(admin)
						.get(`/${version}/user?$filter=username eq 'admin'`)
						.expect(200)
				).body.d[0];

				const actor = versions.gt(version, 'v6')
					? record.actor.__id
					: record.actor;

				// Create a token that only has access to the granting users document
				const accessToken = createScopedAccessToken({
					actor,
					permissions: ['resin.user.read?actor eq @__ACTOR_ID'],
					expiresIn: 60 * 10,
				});

				const userActor = (
					await supertest(accessToken).get('/actor/v1/whoami').expect(200)
				).body;

				expect(userActor).to.have.property('id').that.is.a('number');
				expect(userActor.actorType).to.equal('user');
				expect(userActor.actorTypeId).to.equal(admin.id);
				expect(userActor.username).to.equal('admin');
				expect(userActor.email).to.equal(SUPERUSER_EMAIL);
			});

			it('/actor/v1/whoami returns a 401 error when using a scoped access token that does not have user permissions', async function () {
				const record = (
					await supertest(admin)
						.get(`/${version}/user?$filter=username eq 'admin'`)
						.expect(200)
				).body.d[0];

				const actor = versions.gt(version, 'v6')
					? record.actor.__id
					: record.actor;
				const permissions = ['resin.application.read?actor eq @__ACTOR_ID'];

				// Create a token that only has access to the granting users applications
				const accessToken = createScopedAccessToken({
					actor,
					permissions,
					expiresIn: 60 * 10,
				});

				await supertest(accessToken).get('/actor/v1/whoami').expect(401);
			});
		});
	});
};
