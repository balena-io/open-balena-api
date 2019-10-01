import 'mocha';
import { expect } from 'chai';
import * as uuid from 'node-uuid';
import * as randomstring from 'randomstring';

import { app } from '../../init';

import supertest = require('./supertest');

export type Device = {
	id: number;
	uuid: string;
	token: string;
	getStateV2: () => AnyObject;
};

export async function provisionDevice(
	admin: string,
	appId: number,
): Promise<Device> {
	const { body: applications } = await supertest(app, admin)
		.get(`/resin/application(${appId})?$expand=is_for__device_type`)
		.expect(200);

	expect(applications)
		.to.have.property('d')
		.that.is.an('array');
	expect(applications.d).to.have.lengthOf(
		1,
		`Incorrect number of applications found for ID ${appId}`,
	);
	expect(applications.d[0]).to.have.property('is_for__device_type');
	expect(applications.d[0].is_for__device_type)
		.to.be.an('array')
		.with.lengthOf(1);
	expect(applications.d[0].is_for__device_type[0]).to.have.property('slug');

	const deviceType: string = applications.d[0].is_for__device_type[0].slug;

	const { body: device } = await supertest(app, admin)
		.post('/resin/device')
		.send({
			belongs_to__application: appId,
			uuid: uuid
				.v4()
				.replace(/\-/g, '')
				.toLowerCase(),
			device_type: deviceType,
			os_version: '2.38.0+rev1',
			supervisor_version: 'v10.0.0',
		})
		.expect(201);

	device.token = randomstring.generate(16);

	await supertest(app, admin)
		.post(`/api-key/device/${device.id}/device-key`)
		.send({
			apiKey: device.token,
		})
		.expect(200);

	device.getStateV2 = async () => {
		const { body: state } = await supertest(app, device)
			.get(`/device/v2/${device.uuid}/state`)
			.expect(200);

		expect(state).to.have.property('local');
		expect(state.local).to.have.property('name');
		expect(state.local).to.have.property('config');

		return state;
	};

	return device;
}
