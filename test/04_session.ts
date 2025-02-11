import { expect } from 'chai';
import {
	JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH,
	SUPERUSER_EMAIL,
	SUPERUSER_PASSWORD,
} from '@balena/open-balena-api/config';
import { auth } from '@balena/open-balena-api';

import * as fixtures from './test-lib/fixtures.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import type { Device } from './test-lib/fake-device.js';
import type { Application } from '@balena/open-balena-api/models/balena-model.d.ts';
import { permissions as pinePermissions, sbvrUtils } from '@balena/pinejs';
const { api } = sbvrUtils;
import { setTimeout } from 'timers/promises';
import { expectJwt } from './test-lib/api-helpers.js';
import { assertExists } from './test-lib/common.js';

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

			it('/login_ returns 401 when the password is wrong', async function () {
				await supertest()
					.post('/login_')
					.send({
						username: SUPERUSER_EMAIL,
						password: `${SUPERUSER_PASSWORD}_wrong`,
					})
					.expect(401);
			});

			it('/login_ returns a token with only the allowed properties', async function () {
				const token = (
					await supertest()
						.post('/login_')
						.send({
							username: SUPERUSER_EMAIL,
							password: SUPERUSER_PASSWORD,
						})
						.expect(200)
				).text;
				expectJwt(token);
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
				const accessToken = auth.createScopedAccessToken({
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
				const accessToken = auth.createScopedAccessToken({
					actor,
					permissions,
					expiresIn: 60 * 10,
				});

				await supertest(accessToken).get('/user/v1/whoami').expect(401);
			});

			describe('granted user token', function () {
				let token: string;

				before(function () {
					assertExists(admin.token);
					expect(admin.token).to.be.a('string');
					token = admin.token;
				});

				it('should be refreshable with /user/v1/refresh-token and not include extra properties', async function () {
					// wait 2 seconds to make sure the token is already starting to expire
					await setTimeout(2000);

					const res = await supertest({ token })
						.get('/user/v1/refresh-token')
						.expect(200);

					const oldDecodedToken = expectJwt(token);
					const newDecodedToken = expectJwt(res.text);
					token = res.text;

					if (JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH) {
						expect(oldDecodedToken.exp, 'exp should not change').to.be.eq(
							newDecodedToken.exp,
						);

						expect(newDecodedToken.iat, 'should get a newer iat').to.be.gt(
							oldDecodedToken.iat,
						);
						expect(newDecodedToken.iat - oldDecodedToken.iat).to.be.gt(2);
					}
				});

				it('should refresh & update the authTime with a POST to /user/v1/refresh-token using a correct password', async function () {
					const res = await supertest(token)
						.get('/user/v1/refresh-token')
						.expect(200);

					token = res.text;
					const tokenParts = token.split('.');
					expect(tokenParts).to.be.an('array');
					expect(tokenParts).to.have.property('length', 3);
					const payload = expectJwt(token);
					const initialAuthTime: number = payload.authTime;

					const res1 = await supertest(token)
						.post('/user/v1/refresh-token')
						.send({ password: SUPERUSER_PASSWORD })
						.expect(200);

					token = res1.text;
					const tokenParts1 = token.split('.');
					expect(tokenParts1).to.be.an('array');
					expect(tokenParts1).to.have.property('length', 3);
					const payload1 = expectJwt(token);
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
					const payload = expectJwt(token);
					const initialAuthTime: number = payload.authTime;

					const res1 = await supertest(token)
						.post('/user/v1/refresh-token')
						.expect(200);
					token = res1.text;
					const tokenParts1 = token.split('.');
					expect(tokenParts1).to.be.an('array');
					expect(tokenParts1).to.have.property('length', 3);
					const payload1 = expectJwt(token);
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
				const accessToken = auth.createScopedAccessToken({
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
				const accessToken = auth.createScopedAccessToken({
					actor,
					permissions,
					expiresIn: 60 * 10,
				});

				await supertest(accessToken).get('/actor/v1/whoami').expect(401);
			});

			it('/login_ returns a 401 error if user does not have auth.credentials_login permission', async function () {
				const user = (await supertest(admin).get('/user/v1/whoami').expect(200))
					.body;

				const role = await api.Auth.get({
					resource: 'role',
					passthrough: {
						req: pinePermissions.rootRead,
					},
					id: {
						name: 'default-user',
					},
					options: {
						$select: 'id',
					},
				});

				assertExists(role);
				expect(role).to.have.property('id').that.is.a('number');

				await sbvrUtils.db.transaction(async (tx) => {
					await auth.revokeUserRole(user.id, role.id, tx);
				});

				await supertest()
					.post('/login_')
					.send({
						username: SUPERUSER_EMAIL,
						password: SUPERUSER_PASSWORD,
					})
					.expect(401);

				await sbvrUtils.db.transaction(async (tx) => {
					await auth.assignUserRole(user.id, role.id, tx);
				});

				await supertest()
					.post('/login_')
					.send({
						username: SUPERUSER_EMAIL,
						password: SUPERUSER_PASSWORD,
					})
					.expect(200);
			});
		});
	});
};
