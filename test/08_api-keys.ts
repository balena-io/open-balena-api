import { VPN_SERVICE_API_KEY } from '../src/lib/config';
import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import { sbvrUtils, permissions } from '@balena/pinejs';

const { api } = sbvrUtils;

describe('create provisioning apikey', function () {
	before(async function () {
		const fx = await fixtures.load('08-create-device-apikey');
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		this.application = fx.applications.app1;
	});

	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	[
		{
			title: `using /api-key/application/:appId/provisioning endpoint`,
			fn(
				user: UserObjectParam | undefined,
				applicationId: number,
				provisioningKeyName?: string,
			) {
				return supertest(user)
					.post(`/api-key/application/${applicationId}/provisioning`)
					.send({
						name: provisioningKeyName,
					});
			},
		},
		{
			title: 'using the /api-key/v1/ endpoint',
			fn(
				user: UserObjectParam | undefined,
				applicationId: number,
				provisioningKeyName?: string,
			) {
				return supertest(user)
					.post(`/api-key/v1/`)
					.send({
						actorType: 'application',
						actorTypeId: applicationId,
						roles: ['provisioning-api-key'],
						name: provisioningKeyName,
					});
			},
		},
	].forEach(({ title, fn }) => {
		describe(title, function () {
			const uuid =
				'f716a3e020bd444b885cb394453917520c3cf82e69654f84be0d33e31a0e15';

			after(async function () {
				await supertest(this.user)
					.delete(`/${version}/device?$filter=uuid eq '${uuid}'`)
					.expect(200);
			});

			it('should not allow unauthorized requests', async function () {
				await fn(undefined, this.application.id).expect(401);
			});

			it('should be able to create a provisioning key', async function () {
				const applicationId = this.application.id;
				const { body: provisioningKey } = await fn(
					this.user,
					applicationId,
					`provision-key-${applicationId}`,
				).expect(200);

				expect(provisioningKey).to.be.a('string');
				this.provisioningKey = provisioningKey;

				// check the name assigned
				const apiKeyResp = await api.resin.get({
					resource: 'api_key',
					passthrough: {
						req: permissions.root,
					},
					id: {
						key: provisioningKey,
					},
					options: {
						$select: 'name',
					},
				});

				expect(apiKeyResp).to.have.property('name');
				expect(apiKeyResp?.name).to.be.a('string');
				expect(apiKeyResp?.name).to.equal(`provision-key-${applicationId}`);
			});

			it('then register a device using the provisioning key', async function () {
				const { body: device } = await supertest()
					.post(`/device/register?apikey=${this.provisioningKey}`)
					.send({
						user: this.user.id,
						application: this.application.id,
						device_type: 'raspberry-pi',
						uuid,
					})
					.expect(201);

				expect(device).to.have.property('id').that.is.a('number');
				expect(device).to.have.property('uuid', uuid);
				expect(device).to.have.property('api_key').that.is.a('string');
			});
		});
	});
});

describe('create device apikey', function () {
	before(async function () {
		const fx = await fixtures.load('08-create-device-apikey');
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		this.application = fx.applications.app1;
		this.device = fx.devices.device1;
	});

	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	[
		{
			title: 'using the /api-key/device/deviceId/device-key endpoint',
			fn(
				user: UserObjectParam | undefined,
				deviceId: number,
				body?: AnyObject,
			) {
				return supertest(user)
					.post(`/api-key/device/${deviceId}/device-key`)
					.send(body);
			},
		},
		{
			title: 'using the /api-key/v1/ endpoint',
			fn(
				user: UserObjectParam | undefined,
				deviceId: number,
				body?: AnyObject,
			) {
				return supertest(user)
					.post(`/api-key/v1/`)
					.send({
						actorType: 'device',
						actorTypeId: deviceId,
						roles: ['device-api-key'],
						...body,
					});
			},
		},
	].forEach(({ title, fn }, i) => {
		describe(title, function () {
			it('should create an apikey when none is passed', async function () {
				const { body: apiKey } = await fn(this.user, this.device.id, {}).expect(
					200,
				);

				expect(apiKey).to.be.a('string');
				expect(apiKey).to.not.be.empty;
			});

			it('should create an apikey with the value passed in the body', async function () {
				const apiKey = `bananas${i}`;
				const { body: deviceApiKey } = await fn(this.user, this.device.id, {
					apiKey,
				}).expect(200);

				expect(deviceApiKey).to.be.a('string');
				expect(deviceApiKey).to.equal(apiKey);
			});

			it('should not allow unauthorized requests', async function () {
				await fn(undefined, this.device.id).expect(401);
			});
		});
	});
});

describe('create named user apikey', function () {
	let userIdForUnauthorizedRequest = 0;

	before(async function () {
		const fx = await fixtures.load();
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		userIdForUnauthorizedRequest = this.user.id;
	});
	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	[
		{
			title: 'using the /api-key/user/full endpoint',
			fn(user: UserObjectParam | undefined, body?: AnyObject) {
				return supertest(user).post(`/api-key/user/full`).send(body);
			},
		},
		{
			title: 'using the /api-key/v1/ endpoint',
			fn(user: UserObjectParam | undefined, body?: AnyObject) {
				return supertest(user)
					.post(`/api-key/v1/`)
					.send({
						actorType: 'user',
						actorTypeId: user?.id ?? userIdForUnauthorizedRequest,
						roles: ['named-user-api-key'],
						...body,
					});
			},
		},
	].forEach(({ title, fn }) => {
		describe(title, function () {
			it('should not allow unauthorized requests', async () => {
				await fn(undefined, undefined).expect(401);
			});

			it('should not allow requests without name', async function () {
				await fn(this.user, {}).expect(400);
			});

			it('should not allow requests with an empty name', async function () {
				await fn(this.user, { name: '' }).expect(400);
			});

			it('should allow api keys without description', async function () {
				const { body: apiKey } = await fn(this.user, {
					name: 'some-name',
				}).expect(200);

				expect(apiKey).to.be.a('string');
				expect(apiKey).to.not.be.empty;
			});

			it('should allow api keys with description', async function () {
				const { body: apiKey } = await fn(this.user, {
					name: 'other-name',
					description: 'a description',
				}).expect(200);

				expect(apiKey).to.be.a('string');
				expect(apiKey).to.not.be.empty;
			});
		});
	});
});

describe('use api key instead of jwt', function () {
	before(async function () {
		const fx = await fixtures.load();
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
	});

	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should accept api keys on the Authorization header on custom endpoints already expecting only api keys', async function () {
		const { status } = await supertest(VPN_SERVICE_API_KEY).post(
			'/services/vpn/client-connect',
		);

		expect(status).to.not.equal(401);
	});

	const RESTRICTED_ENDPOINTS: Array<{
		method: 'get' | 'post';
		path: string;
		body?: AnyObject;
		status?: number;
	}> = [
		{ method: 'post', path: '/api-key/user/full', body: { name: 'aname' } },
	];

	[
		{
			title: 'when generated using the /api-key/user/full endpoint',
			async beforeFn() {
				const { body: namedApiKey } = await supertest(this.user)
					.post('/api-key/user/full')
					.send({ name: 'named' })
					.expect(200);

				expect(namedApiKey).to.be.a('string');
				this.namedApiKey = namedApiKey;
			},
		},
		{
			title: 'when generated using the /api-key/v1/ endpoint',
			async beforeFn() {
				const { body: namedApiKey } = await supertest(this.user)
					.post(`/api-key/v1/`)
					.send({
						actorType: 'user',
						actorTypeId: this.user.id,
						roles: ['named-user-api-key'],
						name: 'named',
					});

				expect(namedApiKey).to.be.a('string');
				this.namedApiKey = namedApiKey;
			},
		},
	].forEach(({ title, beforeFn }) => {
		describe(title, function () {
			before(beforeFn);

			it('should be able to access an allowed standard endpoint with a named user-level api key', async function () {
				await supertest()
					.get(`/${version}/user(${this.user.id})?$select=username`)
					.query({ apikey: this.namedApiKey })
					.expect(200);
			});

			it('should accept api keys on the Authorization header on standard endpoints', async function () {
				await supertest(this.namedApiKey)
					.get(`/${version}/user(${this.user.id})?$select=username`)
					.expect(200);
			});

			it('should return user info', async function () {
				const { body } = await supertest(this.namedApiKey)
					.get('/user/v1/whoami')
					.expect(200);

				expect(body).to.have.property('id');
				expect(body).to.have.property('username');
				expect(body).to.have.property('email');
			});

			describe('should correctly control access to named user-level api keys', function () {
				RESTRICTED_ENDPOINTS.forEach(({ method, path, body }) => {
					it(`${method} ${path}`, async function () {
						await supertest()
							[method](path)
							.query({ apikey: this.namedApiKey })
							.send(body)
							.expect(401);
					});
				});
			});
		});
	});

	describe('should correctly control access to JWTs', function () {
		RESTRICTED_ENDPOINTS.forEach(({ method, path, body, status = 200 }) => {
			it(`${method} ${path}`, async function () {
				await supertest(this.user)[method](path).send(body).expect(status);
			});
		});
	});
});

describe('standard api key endpoints', async function () {
	before(async function () {
		const fx = await fixtures.load();

		this.loadedFixtures = fx;
		this.user = fx.users.admin;

		const { body: apikey } = await supertest(this.user)
			.post('/api-key/user/full')
			.send({ name: 'witty' })
			.expect(200);

		expect(apikey).to.be.a('string');
		this.apikey = apikey;
	});
	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should not allow api keys to be created using the standard endpoint', async function () {
		await supertest(this.user)
			.post(`/${version}/api_key`)
			.send({ name: 'witty' })
			.expect(401);
	});

	it('should allow api keys to read api keys', async function () {
		const { body } = await supertest()
			.get(`/${version}/api_key?$select=name`)
			.query({ apikey: this.apikey })
			.expect(200);

		expect(body).to.have.property('d').that.has.length(1);
		expect(body.d[0]).to.have.property('name').that.equals('witty');
	});

	it('should allow users to read api keys', async function () {
		const { body } = await supertest(this.user)
			.get(`/${version}/api_key?$select=id,name`)
			.expect(200);
		expect(body).to.have.property('d').that.has.length(1);
		const [apiKey] = body.d;
		expect(apiKey).to.have.property('id').that.is.a('number');
		expect(apiKey).to.have.property('name').that.equals('witty');
		this.apiKeyId = apiKey.id;
	});

	it('should not allow api keys to update api keys', async function () {
		await supertest()
			.patch(`/${version}/api_key(${this.apiKeyId})`)
			.query({ apikey: this.apikey })
			.send({ name: 'unfunny' })
			.expect(401);
	});

	it('should allow users to update api keys', async function () {
		await supertest(this.user)
			.patch(`/${version}/api_key(${this.apiKeyId})`)
			.send({ name: 'unfunny' })
			.expect(200);

		const { body } = await supertest(this.user)
			.get(`/${version}/api_key?$select=name`)
			.expect(200);
		expect(body).to.have.property('d').that.has.length(1);
		expect(body.d[0]).to.have.property('name').that.equals('unfunny');
	});

	it('should not allow api keys to delete api keys', async function () {
		await supertest()
			.del(`/${version}/api_key(${this.apiKeyId})`)
			.query({ apikey: this.apikey })
			.expect(401);
	});

	it('should allow users to delete api keys', async function () {
		await supertest(this.user)
			.del(`/${version}/api_key(${this.apiKeyId})`)
			.expect(200);

		const { body } = await supertest(this.user)
			.get(`/${version}/api_key?$select=id`)
			.expect(200);

		expect(body).to.have.property('d').that.has.length(0);
	});
});

describe('generic-api-key-endpoint', function () {
	before(async function () {
		const fx = await fixtures.load();
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
	});

	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	describe('parameter checks', function () {
		it('should reject unauthorized requests', async function () {
			await supertest()
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: ['named-user-api-key'],
					name: 'a-different-name',
				})
				.expect(401);
		});

		it('should reject requests for an unsupported actor type', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'organization',
					actorTypeId: this.user.id,
					roles: ['named-user-api-key'],
					name: 'a-different-name',
				})
				.expect(400, '"Unsupported actor type"');
		});

		it('should reject requests when the actor type id is missing', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					roles: ['named-user-api-key'],
					name: 'a-different-name',
				})
				.expect(400, '"Actor type id must be a number"');
		});

		it('should reject requests when no roles are provided', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: [],
					name: 'a-different-name',
				})
				.expect(400);
		});

		it('should reject requests when the roles are not an array', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: 'named-user-api-key',
					name: 'a-different-name',
				})
				.expect(400, '"Roles should be an array of role names"');
		});

		it('should reject requests when the role is not a non-empty string', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: [''],
					name: 'a-different-name',
				})
				.expect(400, '"Roles should be an array of role names"');

			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: [5],
					name: 'a-different-name',
				})
				.expect(400, '"Roles should be an array of role names"');
		});

		it('should reject requests when more than one roles are provided', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: ['named-user-api-key', 'provisioning-api-key'],
					name: 'a-different-name',
				})
				.expect(400, '"API Keys currently only support a single role"');
		});

		it('should reject requests for named api keys without a name', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: ['named-user-api-key'],
				})
				.expect(
					400,
					`"API keys with the 'named-user-api-key' role require a name"`,
				);
		});

		it('should reject requests for named api keys with an empty name', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: ['named-user-api-key'],
					name: '',
				})
				.expect(
					400,
					`"API keys with the 'named-user-api-key' role require a name"`,
				);
		});

		it('should be able to create a named api key', async function () {
			await supertest(this.user)
				.post(`/api-key/v1`)
				.send({
					actorType: 'user',
					actorTypeId: this.user.id,
					roles: ['named-user-api-key'],
					name: 'a-different-name',
				})
				.expect(200);
		});
	});
});
