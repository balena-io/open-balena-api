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
			this.deviceKey = randomstring.generate();
			this.device = await registerDevice({
				deviceKey: this.deviceKey,
			});
		});

		it('should authorize the device to access the VPN', async function () {
			await supertest(this.deviceKey)
				.get(`/services/vpn/auth/${this.device.uuid}`)
				.expect(200);
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
			// TODO: This atm fails b/c of https://github.com/balena-io/balena-api/issues/3371
			await expect(
				supertest(this.deviceKey)
					.get(`/services/vpn/auth/${this.uuid}`)
					.expect(200),
			).to.be.rejected;
		});
	});
});
