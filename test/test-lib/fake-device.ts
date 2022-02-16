import { expect } from 'chai';
import * as randomstring from 'randomstring';
import { randomUUID } from 'crypto';

import { supertest, UserObjectParam } from './supertest';
import { version } from './versions';
import { StateV2 } from '../../src/features/device-state/routes/state-get-v2';
import { StatePatchV2Body } from '../../src/features/device-state/routes/state-patch-v2';

export async function getState(
	user: UserObjectParam,
	deviceUuid: string,
	stateVersion: 'v2' = 'v2',
): Promise<StateV2> {
	const { body: state } = await supertest(user)
		.get(`/device/${stateVersion}/${deviceUuid}/state`)
		.expect(200);

	expect(state).to.have.property('local');
	expect(state.local).to.have.property('name');
	expect(state.local).to.have.property('config');

	return state;
}

export const generateDeviceUuid = () =>
	randomUUID().replace(/\-/g, '').toLowerCase();

export async function provisionDevice(
	admin: UserObjectParam,
	appId: number,
	osVersion?: string,
	supervisorVersion?: string,
) {
	const { body: applications } = await supertest(admin)
		.get(`/${version}/application(${appId})?$expand=is_for__device_type`)
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

	const deviceTypeId: string = applications.d[0].is_for__device_type[0].id;

	const deviceUuid = generateDeviceUuid();
	const { body: deviceEntry } = await supertest(admin)
		.post(`/${version}/device`)
		.send({
			belongs_to__application: appId,
			uuid: deviceUuid,
			is_of__device_type: deviceTypeId,
		})
		.expect(201);

	const device = {
		...(deviceEntry as {
			id: number;
			uuid: string;
		}),
		token: randomstring.generate(16),
		getStateV2: async (): Promise<StateV2> => {
			return await getState(device, device.uuid);
		},
		patchStateV2: async (devicePatchBody: StatePatchV2Body) => {
			await supertest(device)
				.patch(`/device/v2/${device.uuid}/state`)
				.send(devicePatchBody)
				.expect(200);
		},
	};

	await supertest(admin)
		.post(`/api-key/device/${device.id}/device-key`)
		.send({
			apiKey: device.token,
		})
		.expect(200);

	await device.patchStateV2({
		local: {
			os_version: osVersion,
			supervisor_version: supervisorVersion,
		},
	});

	const { body: provisionedDevice } = await supertest(admin)
		.get(`/${version}/device(uuid='${deviceUuid}')?$select=supervisor_version`)
		.expect(200);
	expect(provisionedDevice.d[0].supervisor_version).to.equal(
		supervisorVersion ?? null,
	);

	return device;
}

export type Device = ResolvableReturnType<typeof provisionDevice>;
