import { expect } from 'chai';
import 'mocha';
import * as randomstring from 'randomstring';
import * as uuid from 'uuid';

import { app } from '../../init';

import { supertest, UserObjectParam } from './supertest';

interface DeviceStateApp {
	name: string;
	commit: string;
	releaseId: number;
	services: _.Dictionary<{
		image: string;
		volumes: string[];
		imageId: number;
		serviceName: string;
		running: boolean;
		environment: _.Dictionary<string>;
		labels: _.Dictionary<string>;
	}>;
	volumes: _.Dictionary<_.Dictionary<string>>;
	networks: _.Dictionary<AnyObject>;
}

export interface DeviceState {
	local: {
		name?: string;
		supervisor_version?: string;
		config: _.Dictionary<string>;
		apps: _.Dictionary<DeviceStateApp>;
	};
	dependent: {
		apps: _.Dictionary<DeviceStateApp>;
		devices: AnyObject;
	};
}

export async function provisionDevice(admin: UserObjectParam, appId: number) {
	const { body: applications } = await supertest(app, admin)
		.get(`/resin/application(${appId})?$expand=is_for__device_type`)
		.expect(200);

	expect(applications).to.have.property('d').that.is.an('array');
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

	const { body: deviceEntry } = await supertest(app, admin)
		.post('/resin/device')
		.send({
			belongs_to__application: appId,
			uuid: uuid.v4().replace(/\-/g, '').toLowerCase(),
			device_type: deviceType,
		})
		.expect(201);

	const device = {
		...(deviceEntry as {
			id: number;
			uuid: string;
		}),
		token: randomstring.generate(16),
		getStateV2: async (): Promise<DeviceState> => {
			const { body: state } = await supertest(app, device)
				.get(`/device/v2/${device.uuid}/state`)
				.expect(200);

			expect(state).to.have.property('local');
			expect(state.local).to.have.property('name');
			expect(state.local).to.have.property('config');

			return state;
		},
		patchStateV2: async (devicePatchBody: AnyObject) => {
			await supertest(app, device)
				.patch(`/device/v2/${device.uuid}/state`)
				.send(devicePatchBody)
				.expect(200);
		},
	};

	await supertest(app, admin)
		.post(`/api-key/device/${device.id}/device-key`)
		.send({
			apiKey: device.token,
		})
		.expect(200);

	return device;
}

export type Device = ResolvableReturnType<typeof provisionDevice>;
