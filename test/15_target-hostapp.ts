import * as _ from 'lodash';
import * as fixtures from './test-lib/fixtures';
import * as fakeDevice from './test-lib/fake-device';
import { expect } from './test-lib/chai';

import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';

describe('target hostapps', () => {
	// TODO should test:
	// [x] ESR
	// [x] ensure no upgrading to a different DT (need a rule)
	// [x] no downgrades (need a hook)
	// [x] multiple variants
	//
	// maybe these are for closed-api:
	// can migrate ESR -> non-ESR (do we/should we support this?)
	// [x] can migrate non-ESR -> ESR
	// do we need ESR at all in oB?
	// private DTs (probably closed)
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	let device: fakeDevice.Device;
	let esrDevice: fakeDevice.Device;
	let noMatchDevice: fakeDevice.Device;
	let prodNucHostappReleaseId: number;
	let raspberryPiHostappReleaseId: number;
	let upgradeReleaseId: number;
	let esrHostappReleaseId: number;

	before(async () => {
		fx = await fixtures.load('15-target-hostapps');
		admin = fx.users.admin;
		applicationId = fx.applications['user-app1'].id;
		device = await fakeDevice.provisionDevice(admin, applicationId);
		esrDevice = await fakeDevice.provisionDevice(admin, applicationId);
		noMatchDevice = await fakeDevice.provisionDevice(admin, applicationId);
		prodNucHostappReleaseId = fx.releases.release0.id;
		raspberryPiHostappReleaseId = fx.releases.release1.id;
		upgradeReleaseId = fx.releases.release2.id;
		esrHostappReleaseId = fx.releases.release3.id;
	});

	after(async () => {
		await fixtures.clean({ devices: [device, esrDevice, noMatchDevice] });
		await fixtures.clean(fx);
	});

	it('should provision with a linked hostapp', async () => {
		const devicePatchBody = {
			local: {
				is_online: true,
				os_version: 'balenaOS 2.50.0+rev1',
				os_variant: 'prod',
			},
		};

		await device.patchStateV2(devicePatchBody);
		const { body } = await supertest(admin)
			.get(
				`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
			)
			.expect(200);
		expect(body.d[0]).to.not.be.undefined;
		expect(body.d[0]['should_be_operated_by__release']).to.be.not.null;
		expect(body.d[0]['should_be_operated_by__release'].__id).to.equal(
			prodNucHostappReleaseId,
		);
	});

	it('should provision with a linked ESR hostapp', async () => {
		const devicePatchBody = {
			local: {
				is_online: true,
				os_version: 'balenaOS 2021.01.0',
				os_variant: 'prod',
			},
		};

		await esrDevice.patchStateV2(devicePatchBody);
		const { body } = await supertest(admin)
			.get(
				`/${version}/device(${esrDevice.id})?$select=should_be_operated_by__release`,
			)
			.expect(200);
		expect(body.d[0]).to.not.be.undefined;
		expect(body.d[0]['should_be_operated_by__release']).to.be.not.null;
	});

	it('should fail to PATCH intel-nuc device to raspberrypi3 hostapp', async () => {
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({ should_be_operated_by__release: raspberryPiHostappReleaseId })
			.expect(
				400,
				'"It is necessary that each release that should operate a device, belongs to an application that is host and is for a device type that describes the device."',
			);
	});

	it('should succeed in PATCHing device to greater version', async () => {
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({ should_be_operated_by__release: upgradeReleaseId })
			.expect(200);
		const { body } = await supertest(admin).get(
			`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
		);
		expect(body.d[0]).to.not.be.undefined;
		expect(body.d[0]['should_be_operated_by__release'].__id).to.equal(
			upgradeReleaseId,
		);
	});

	it('should fail to downgrade', async () => {
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({ should_be_operated_by__release: fx.releases.release0.id })
			.expect(400, '"Attempt to downgrade hostapp, which is not allowed"');
	});

	it('should succeed in PATCHing device to ESR release', async () => {
		await supertest(admin)
			.patch(`/${version}/device(${device.id})`)
			.send({ should_be_operated_by__release: esrHostappReleaseId })
			.expect(200);
		const { body } = await supertest(admin).get(
			`/${version}/device(${device.id})?$select=should_be_operated_by__release`,
		);
		expect(body.d[0]).to.not.be.undefined;
		expect(body.d[0]['should_be_operated_by__release'].__id).to.equal(
			esrHostappReleaseId,
		);
	});

	it('should still provision with a nonexistent hostapp', async () => {
		const devicePatchBody = {
			local: {
				is_online: true,
				os_version: 'balenaOS 2999.01.0',
				os_variant: 'prod',
			},
		};

		await noMatchDevice.patchStateV2(devicePatchBody);
		const { body } = await supertest(admin)
			.get(
				`/${version}/device(${noMatchDevice.id})?$select=should_be_operated_by__release`,
			)
			.expect(200);
		expect(body.d[0]).to.not.be.undefined;
		expect(body.d[0]['should_be_operated_by__release']).to.be.null;
		expect(body.d[0]['os_version']).to.be.not.null;
		expect(body.d[0]['os_variant']).to.be.not.null;
	});
});
