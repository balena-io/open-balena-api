import { VPN_SERVICE_API_KEY } from '../src/lib/config';
import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import { supertest } from './test-lib/supertest';
import { app } from '../init';

describe('create provisioning apikey', function () {
	before(async function () {
		const fx = await fixtures.load('08-create-device-apikey');
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		this.application = fx.applications.app1;
	});

	after(async function () {
		await supertest(app, this.user).delete(`/resin/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should be able to create a provisioning key', async function () {
		const { body: provisioningKey } = await supertest(app, this.user)
			.post(`/api-key/application/${this.application.id}/provisioning`)
			.expect(200);

		expect(provisioningKey).to.be.a('string');
		this.provisioningKey = provisioningKey;
	});

	it('then register a device using the provisioning key', async function () {
		const uuid =
			'f716a3e020bd444b885cb394453917520c3cf82e69654f84be0d33e31a0e15';
		const { body: device } = await supertest(app)
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

describe('create device apikey', function () {
	before(async function () {
		const fx = await fixtures.load('08-create-device-apikey');
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		this.application = fx.applications.app1;
		this.device = fx.devices.device1;
	});

	after(async function () {
		await supertest(app, this.user).delete(`/resin/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should create an apikey when none is passed', async function () {
		const { body: apiKey } = await supertest(app, this.user)
			.post(`/api-key/device/${this.device.id}/device-key`)
			.send({})
			.expect(200);

		expect(apiKey).to.be.a('string');
		expect(apiKey).to.not.be.empty;
	});

	it('should create an apikey with the value passed in the body', async function () {
		const apiKey = 'bananas';
		const { body: deviceApiKey } = await supertest(app, this.user)
			.post(`/api-key/device/${this.device.id}/device-key`)
			.send({ apiKey })
			.expect(200);

		expect(deviceApiKey).to.be.a('string');
		expect(deviceApiKey).to.equal(apiKey);
	});

	it('should not allow unauthorized requests', async function () {
		await supertest(app)
			.post(`/api-key/device/${this.device.id}/device-key`)
			.expect(401);
	});
});

describe('create named user apikey', function () {
	before(async function () {
		const fx = await fixtures.load();
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
	});
	after(async function () {
		await supertest(app, this.user).delete(`/resin/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should not allow unauthorized requests', async () => {
		await supertest(app).post('/api-key/user/full').expect(401);
	});

	it('should not allow requests without name', async function () {
		await supertest(app, this.user)
			.post('/api-key/user/full')
			.send({})
			.expect(400);
	});

	it('should not allow requests with an empty name', async function () {
		await supertest(app, this.user)
			.post('/api-key/user/full')
			.send({ name: '' })
			.expect(400);
	});

	it('should allow api keys without description', async function () {
		const { body: apiKey } = await supertest(app, this.user)
			.post('/api-key/user/full')
			.send({ name: 'some-name' })
			.expect(200);

		expect(apiKey).to.be.a('string');
		expect(apiKey).to.not.be.empty;
	});

	it('should allow api keys with description', async function () {
		const { body: apiKey } = await supertest(app, this.user)
			.post('/api-key/user/full')
			.send({ name: 'other-name', description: 'a description' })
			.expect(200);

		expect(apiKey).to.be.a('string');
		expect(apiKey).to.not.be.empty;
	});
});

describe('use api key instead of jwt', function () {
	before(async function () {
		const fx = await fixtures.load();
		this.loadedFixtures = fx;
		this.user = fx.users.admin;

		const { body: namedApiKey } = await supertest(app, this.user)
			.post('/api-key/user/full')
			.send({ name: 'named' })
			.expect(200);

		expect(namedApiKey).to.be.a('string');
		this.namedApiKey = namedApiKey;
	});

	after(async function () {
		await supertest(app, this.user).delete(`/resin/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should accept api keys on the Authorization header on custom endpoints already expecting only api keys', async function () {
		const { status } = await supertest(app, VPN_SERVICE_API_KEY).post(
			'/services/vpn/client-connect',
		);

		expect(status).to.not.equal(401);
	});

	it('should be able to access an allowed standard endpoint with a named user-level api key', async function () {
		await supertest(app)
			.get(`/resin/user(${this.user.id})?$select=username`)
			.query({ apikey: this.namedApiKey })
			.expect(200);
	});

	it('should accept api keys on the Authorization header on standard endpoints', async function () {
		await supertest(app, this.namedApiKey)
			.get(`/resin/user(${this.user.id})?$select=username`)
			.expect(200);
	});

	it('should return user info', async function () {
		const { body } = await supertest(app, this.namedApiKey)
			.get('/user/v1/whoami')
			.expect(200);

		expect(body).to.have.property('id');
		expect(body).to.have.property('username');
		expect(body).to.have.property('email');
	});

	const RESTRICTED_ENDPOINTS: Array<{
		method: 'get' | 'post';
		path: string;
		body?: AnyObject;
		status?: number;
	}> = [
		{ method: 'post', path: '/api-key/user/full', body: { name: 'aname' } },
	];

	describe('should correctly control access to named user-level api keys', function () {
		RESTRICTED_ENDPOINTS.forEach(({ method, path, body }) => {
			it(`${method} ${path}`, async function () {
				await supertest(app)
					[method](path)
					.query({ apikey: this.namedApiKey })
					.send(body)
					.expect(401);
			});
		});
	});

	describe('should correctly control access to JWTs', function () {
		RESTRICTED_ENDPOINTS.forEach(({ method, path, body, status = 200 }) => {
			it(`${method} ${path}`, async function () {
				await supertest(app, this.user)[method](path).send(body).expect(status);
			});
		});
	});
});

describe('standard api key endpoints', async function () {
	before(async function () {
		const fx = await fixtures.load();

		this.loadedFixtures = fx;
		this.user = fx.users.admin;

		const { body: apikey } = await supertest(app, this.user)
			.post('/api-key/user/full')
			.send({ name: 'witty' })
			.expect(200);

		expect(apikey).to.be.a('string');
		this.apikey = apikey;
	});
	after(async function () {
		await supertest(app, this.user).delete(`/resin/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	it('should not allow api keys to be created using the standard endpoint', async function () {
		await supertest(app, this.user)
			.post(`/resin/api_key`)
			.send({ name: 'witty' })
			.expect(401);
	});

	it('should allow api keys to read api keys', async function () {
		const { body } = await supertest(app)
			.get(`/resin/api_key?$select=name`)
			.query({ apikey: this.apikey })
			.expect(200);

		expect(body).to.have.property('d').that.has.length(1);
		expect(body.d[0]).to.have.property('name').that.equals('witty');
	});

	it('should allow users to read api keys', async function () {
		const { body } = await supertest(app, this.user)
			.get(`/resin/api_key?$select=id,name`)
			.expect(200);
		expect(body).to.have.property('d').that.has.length(1);
		const [apiKey] = body.d;
		expect(apiKey).to.have.property('id').that.is.a('number');
		expect(apiKey).to.have.property('name').that.equals('witty');
		this.apiKeyId = apiKey.id;
	});

	it('should not allow api keys to update api keys', async function () {
		await supertest(app)
			.patch(`/resin/api_key(${this.apiKeyId})`)
			.query({ apikey: this.apikey })
			.send({ name: 'unfunny' })
			.expect(401);
	});

	it('should allow users to update api keys', async function () {
		await supertest(app, this.user)
			.patch(`/resin/api_key(${this.apiKeyId})`)
			.send({ name: 'unfunny' })
			.expect(200);

		const { body } = await supertest(app, this.user)
			.get(`/resin/api_key?$select=name`)
			.expect(200);
		expect(body).to.have.property('d').that.has.length(1);
		expect(body.d[0]).to.have.property('name').that.equals('unfunny');
	});

	it('should not allow api keys to delete api keys', async function () {
		await supertest(app)
			.del(`/resin/api_key(${this.apiKeyId})`)
			.query({ apikey: this.apikey })
			.expect(401);
	});

	it('should allow users to delete api keys', async function () {
		await supertest(app, this.user)
			.del(`/resin/api_key(${this.apiKeyId})`)
			.expect(200);

		const { body } = await supertest(app, this.user)
			.get(`/resin/api_key?$select=id`)
			.expect(200);

		expect(body).to.have.property('d').that.has.length(0);
	});
});
