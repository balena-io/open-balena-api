import { expect } from 'chai';
import jsonwebtoken from 'jsonwebtoken';
import {
	JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH,
	SUPERUSER_EMAIL,
	SUPERUSER_PASSWORD,
} from '../src/lib/config.js';
import {
	createScopedAccessToken,
	createScopedRolesToken,
	generateNewJwtSecret,
} from '../src/infra/auth/jwt.js';

import * as fixtures from './test-lib/fixtures.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import type { Device } from './test-lib/fake-device.js';
import type { Application } from '../src/balena-model.js';
import {
	assignRolePermission,
	assignUserRole,
	getOrInsertPermissionId,
	getOrInsertRoleId,
	getRolePermissions,
	revokeUserRole,
} from '../src/infra/auth/permissions.js';
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
					await revokeUserRole(user.id, role.id, tx);
				});

				await supertest()
					.post('/login_')
					.send({
						username: SUPERUSER_EMAIL,
						password: SUPERUSER_PASSWORD,
					})
					.expect(401);

				await sbvrUtils.db.transaction(async (tx) => {
					await assignUserRole(user.id, role.id, tx);
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

	describe('scoped roles token', function () {
		const ROLE_NAME = 'test-scoped-role';
		const ROLE_PERMISSION = 'resin.user.read?actor eq @__ACTOR_ID';
		const BOUND_ROLE_NAME = 'test-scoped-role-bound';
		const BOUND_ROLE_PERMISSION = 'resin.user.read?id eq @__TEST_USER_ID';
		const COMMA_ROLE_NAME = 'test-scoped-comma-a,test-scoped-comma-b';
		const EXPIRES_IN = 10 * 60;

		let admin: UserObjectParam;
		let userId: number;
		let actor: number;
		let jwtSecret: string;
		const roleIds: number[] = [];

		const setUserJwtSecret = async (newSecret: string) => {
			await api.resin.patch({
				resource: 'user',
				id: userId,
				passthrough: { req: pinePermissions.root },
				body: { jwt_secret: newSecret },
			});
		};

		before(async function () {
			const fx = await fixtures.load();
			admin = fx.users.admin;
			assertExists(admin.id);
			userId = admin.id;

			const user = await api.resin.get({
				resource: 'user',
				id: userId,
				passthrough: { req: pinePermissions.rootRead },
				options: { $select: ['actor', 'jwt_secret'] },
			});
			assertExists(user);
			actor = user.actor.__id;
			assertExists(user.jwt_secret);
			jwtSecret = user.jwt_secret;

			await sbvrUtils.db.transaction(async (tx) => {
				for (const [roleName, permissionName] of [
					[ROLE_NAME, ROLE_PERMISSION],
					[BOUND_ROLE_NAME, BOUND_ROLE_PERMISSION],
					[COMMA_ROLE_NAME, ROLE_PERMISSION],
				] as const) {
					const role = await getOrInsertRoleId(roleName, tx);
					const permission = await getOrInsertPermissionId(permissionName, tx);
					await assignRolePermission(role.id, permission.id, tx);
					roleIds.push(role.id);
				}
			});
		});

		after(async function () {
			// Only remove the roles and their permission links, as the permissions
			// themselves might pre-exist assigned to other roles
			await api.Auth.delete({
				resource: 'role__has__permission',
				passthrough: { req: pinePermissions.root },
				options: { $filter: { role: { $in: roleIds } } },
			});
			await api.Auth.delete({
				resource: 'role',
				passthrough: { req: pinePermissions.root },
				options: { $filter: { id: { $in: roleIds } } },
			});
		});

		it('should authorize a request allowed by the role permissions', async function () {
			const token = createScopedRolesToken({
				actor,
				roles: [ROLE_NAME],
				bindings: {},
				expiresIn: EXPIRES_IN,
			});
			const user = (await supertest(token).get('/user/v1/whoami').expect(200))
				.body;
			expect(user.username).to.equal('admin');
		});

		it('should only include the expected claims in the token', function () {
			const withoutRevocation = jsonwebtoken.decode(
				createScopedRolesToken({
					actor,
					roles: [ROLE_NAME],
					bindings: {},
					expiresIn: EXPIRES_IN,
				}),
			);
			expect(withoutRevocation).to.have.keys([
				'actor',
				'roles',
				'bindings',
				'iat',
				'exp',
			]);

			const withRevocation = jsonwebtoken.decode(
				createScopedRolesToken({
					actor,
					roles: [ROLE_NAME],
					bindings: {},
					expiresIn: EXPIRES_IN,
					jwt_secret: jwtSecret,
				}),
			);
			expect(withRevocation).to.have.keys([
				'actor',
				'roles',
				'bindings',
				'jwt_secret',
				'iat',
				'exp',
			]);
		});

		it('should apply the bindings to the role permissions', async function () {
			const allowed = createScopedRolesToken({
				actor,
				roles: [BOUND_ROLE_NAME],
				bindings: { '@__TEST_USER_ID': `${userId}` },
				expiresIn: EXPIRES_IN,
			});
			const allowedUsers = (
				await supertest(allowed).get('/resin/user?$select=id').expect(200)
			).body.d;
			expect(allowedUsers).to.have.length(1);
			expect(allowedUsers[0].id).to.equal(userId);

			const denied = createScopedRolesToken({
				actor,
				roles: [BOUND_ROLE_NAME],
				bindings: { '@__TEST_USER_ID': '0' },
				expiresIn: EXPIRES_IN,
			});
			const deniedUsers = (
				await supertest(denied).get('/resin/user?$select=id').expect(200)
			).body.d;
			expect(deniedUsers).to.have.length(0);
		});

		it('should return 401 for unknown or empty roles', async function () {
			const unknownRole = createScopedRolesToken({
				actor,
				roles: ['test-scoped-nonexistent-role'],
				bindings: {},
				expiresIn: EXPIRES_IN,
			});
			await supertest(unknownRole).get('/user/v1/whoami').expect(401);

			const noRoles = createScopedRolesToken({
				actor,
				roles: [],
				bindings: {},
				expiresIn: EXPIRES_IN,
			});
			await supertest(noRoles).get('/user/v1/whoami').expect(401);
		});

		it('should return 401 for an expired token', async function () {
			const token = createScopedRolesToken({
				actor,
				roles: [ROLE_NAME],
				bindings: {},
				expiresIn: -EXPIRES_IN,
			});
			await supertest(token).get('/user/v1/whoami').expect(401);
		});

		it('should accept a token bound to the current user jwt_secret', async function () {
			const token = createScopedRolesToken({
				actor,
				roles: [ROLE_NAME],
				bindings: {},
				expiresIn: EXPIRES_IN,
				jwt_secret: jwtSecret,
			});
			await supertest(token).get('/user/v1/whoami').expect(200);
		});

		it('should reject a bound token after the user jwt_secret is rotated', async function () {
			const token = createScopedRolesToken({
				actor,
				roles: [ROLE_NAME],
				bindings: {},
				expiresIn: EXPIRES_IN,
				jwt_secret: jwtSecret,
			});
			await supertest(token).get('/user/v1/whoami').expect(200);
			try {
				await setUserJwtSecret(await generateNewJwtSecret());
				await supertest(token).get('/user/v1/whoami').expect(401);
			} finally {
				// Restore the original secret so that other tests' tokens keep working
				await setUserJwtSecret(jwtSecret);
			}
			await supertest(token).get('/user/v1/whoami').expect(200);
		});

		it('should return 401 when a jwt_secret-bound token resolves to no user', async function () {
			// When a jwt_secret is present the token's actor must resolve to a user
			// with that secret; actor 0 belongs to no user, so the actor-based lookup
			// throws InvalidJwtSecretError.
			const token = createScopedRolesToken({
				actor: 0,
				roles: [ROLE_NAME],
				bindings: {},
				expiresIn: EXPIRES_IN,
				jwt_secret: jwtSecret,
			});
			await supertest(token).get('/user/v1/whoami').expect(401);
		});

		it('should not collide role permission cache keys on role names containing commas', async function () {
			expect(await getRolePermissions([COMMA_ROLE_NAME])).to.deep.equal([
				ROLE_PERMISSION,
			]);
			expect(
				await getRolePermissions(COMMA_ROLE_NAME.split(',')),
			).to.deep.equal([]);
		});
	});
};
