import * as randomstring from 'randomstring';
import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import { generateDeviceUuid } from './test-lib/fake-device';
import { supertest } from './test-lib/supertest';

describe('vpn authentication endpoint', function () {
	let ctx: AnyObject;
	before(async function () {
		const fx = await fixtures.load('17-vpn');
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		this.application = fx.applications.app1;

		const res = await supertest(this.user)
			.post(`/api-key/application/${this.application.id}/provisioning`)
			.expect(200);
		this.provisioningKey = res.body;
		expect(res.body).to.be.a('string');
		ctx = this;
	});

	after(async function () {
		await fixtures.clean(this.loadedFixtures);
	});

	const registerDevice = async ({
		uuid = generateDeviceUuid(),
		deviceKey = randomstring.generate(),
	}: {
		uuid?: string;
		deviceKey?: string;
	} = {}) => {
		const { body: device } = await supertest()
			.post(`/device/register?apikey=${ctx.provisioningKey}`)
			.send({
				user: ctx.user.id,
				application: ctx.application.id,
				device_type: 'raspberry-pi',
				uuid,
				api_key: deviceKey,
			})
			.expect(201);
		expect(device).to.have.property('id').that.is.a('number');
		expect(device).to.have.property('uuid', uuid);
		expect(device).to.have.property('api_key', deviceKey);
		return device;
	};

	describe('given a newly registered device', function () {
		before(async function () {
			this.device = await registerDevice();
		});

		// Keep this succesful authentication first, so that we can test that the caching mechanism is working as expected
		it('should authorize the device to access the VPN', async function () {
			await supertest(this.device.api_key)
				.get(`/services/vpn/auth/${this.device.uuid}`)
				.expect(200);
		});

		it('should not authorize access when using a device key of a different device', async function () {
			const device2 = await registerDevice();
			await supertest(device2.api_key)
				.get(`/services/vpn/auth/${device2.uuid}`)
				.expect(200);
			await supertest(device2.api_key)
				.get(`/services/vpn/auth/${this.device.uuid}`)
				.expect(403);
		});

		it('should not authorize the device to access the VPN if a randomstring is used as the device key', async function () {
			const nonExistingDeviceKey = randomstring.generate();
			await supertest(nonExistingDeviceKey)
				.get(`/services/vpn/auth/${this.device.uuid}`)
				.expect(401);
		});
	});

	describe(`given a token that doesn't match any device api key`, function () {
		before(async function () {
			this.uuid = generateDeviceUuid();
			this.deviceKey = randomstring.generate();
		});

		// Populates the vpn auth cache.
		it('should return a 401 when using a non-existing device api key', async function () {
			await supertest(this.deviceKey)
				.get(`/services/vpn/auth/${this.uuid}`)
				.expect(401);
		});

		// Tests that the vpn auth cache gets cleared when the key is created.
		it('should return a 200 once a device gets registered with the given api key', async function () {
			this.device = await registerDevice({
				uuid: this.uuid,
				deviceKey: this.deviceKey,
			});
			await supertest(this.deviceKey)
				.get(`/services/vpn/auth/${this.uuid}`)
				.expect(200);
		});
	});
});
