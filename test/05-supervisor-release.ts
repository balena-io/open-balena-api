import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import { supertest, UserObjectParam } from './test-lib/supertest';

import { app } from '../init';

import * as fakeDevice from './test-lib/fake-device';

describe('supervisor release', function() {
	let admin: UserObjectParam;

	before(async () => {
		const fx = await fixtures.load();
		admin = fx.users.admin;
	});

	it('should allow admins to create supervisor releases', async () => {
		const res = await supertest(app)
			.get(`/resin/device_type?$select=id&$filter=slug eq 'raspberry-pi'`)
			.expect(200);

		expect(res.body)
			.to.have.nested.property('d[0].id')
			.that.is.a('number');

		await supertest(app, admin)
			.post(`/resin/supervisor_release`)
			.send({
				image_name: 'SOME_IMAGE',
				supervisor_version: '1.2.3',
				is_for__device_type: res.body.d[0].id,
			})
			.expect(201);
	});

	let supervisorReleaseId: number;

	it('should allow admins to read the supervisor release', async () => {
		const res = await supertest(app, admin)
			.get(
				'/resin/supervisor_release?$select=id,image_name,supervisor_version,is_for__device_type',
			)
			.expect(200);
		expect(res.body).to.have.nested.property('d.length', 1);
		expect(res.body.d[0]).to.have.nested.property('image_name');
		expect(res.body.d[0]).to.have.nested.property('supervisor_version');
		expect(res.body.d[0]).to.have.nested.property('is_for__device_type');
		supervisorReleaseId = res.body.d[0].id;
	});

	it('should allow admins to delete the supervisor releases', async () => {
		await supertest(app, admin)
			.delete(`/resin/supervisor_release(${supervisorReleaseId})`)
			.expect(200);
	});
});

describe('Devices running supervisor releases', () => {
	let admin: UserObjectParam;
	let applicationId: number;
	let device: fakeDevice.Device;
	let small: number;
	let middle: number;
	let large: number;
	before(async () => {
		const fx = await fixtures.load('05-supervisor-release');
		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;
		middle = fx['supervisor-releases'].middle.id;

		device = await fakeDevice.provisionDevice(admin, applicationId);

		// let's create some releases
		const res = await supertest(app)
			.get(`/resin/device_type?$select=id&$filter=slug eq 'intel-nuc'`)
			.expect(200);

		expect(res.body)
			.to.have.nested.property('d[0].id')
			.that.is.a('number');

		large = (
			await supertest(app, admin)
				.post(`/resin/supervisor_release`)
				.send({
					image_name: 'SOME_IMAGE',
					supervisor_version: '8.0.1',
					is_for__device_type: res.body.d[0].id,
				})
				.expect(201)
		).body.id;

		small = (
			await supertest(app, admin)
				.post(`/resin/supervisor_release`)
				.send({
					image_name: 'SOME_IMAGE',
					supervisor_version: '6.0.1_logstream',
					is_for__device_type: res.body.d[0].id,
				})
				.expect(201)
		).body.id;
	});

	it('should allow setting a device to a supervisor release', async () => {
		await supertest(app, admin)
			.patch(`/resin/device(${device.id})`)
			.send({
				should_be_managed_by__supervisor_release: small,
			})
			.expect(200);
	});

	it('should allow updrading a devices supervisor release', async () => {
		await supertest(app, admin)
			.patch(`/resin/device(${device.id})`)
			.send({
				should_be_managed_by__supervisor_release: middle,
			})
			.expect(200);
		await supertest(app, admin)
			.patch(`/resin/device(${device.id})`)
			.send({
				should_be_managed_by__supervisor_release: large,
			})
			.expect(200);
	});

	it('should not allow downgrading a supervisor version', async () => {
		await supertest(app, admin)
			.patch(`/resin/device(${device.id})`)
			.send({
				should_be_managed_by__supervisor_release: middle,
			})
			.expect(400);
	});

	it('should correctly determine logstream values', async () => {
		await supertest(app, admin)
			.patch(`/resin/device(${device.id})`)
			.send({
				should_be_managed_by__supervisor_release: small,
			})
			.expect(400);
	});
});
