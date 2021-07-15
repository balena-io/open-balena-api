import { expect } from 'chai';
import * as randomstring from 'randomstring';
import { randomUUID } from 'crypto';

import { supertest, UserObjectParam } from './supertest';
import { version } from './versions';
import { StateV2 } from '../../src/features/device-state/routes/state-v2';
import { StateV3 } from '../../src/features/device-state/routes/state-v3';

export async function getState(
	user: UserObjectParam,
	deviceUuid: string,
	stateVersion?: 'v2',
): Promise<StateV2>;
export async function getState(
	user: UserObjectParam,
	deviceUuid: string,
	stateVersion: 'v3',
): Promise<StateV3>;
export async function getState(
	user: UserObjectParam,
	deviceUuid: string,
	stateVersion: 'v2' | 'v3' = 'v2',
): Promise<StateV2 | StateV3> {
	const { body: state } = await supertest(user)
		.get(`/device/${stateVersion}/${deviceUuid}/state`)
		.expect(200);

	const key = stateVersion === 'v2' ? 'local' : deviceUuid;

	expect(state).to.have.property(key);
	expect(state[key]).to.have.property('name');
	expect(state[key]).to.have.property('apps');

	return state;
}

export async function provisionDevice(
	admin: UserObjectParam,
	appId: number,
	osVersion: string | null = null,
	supervisorVersion: string | null = null,
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

	const deviceType: string = applications.d[0].is_for__device_type[0].slug;

	const deviceUuid = randomUUID().replace(/\-/g, '').toLowerCase();
	const { body: deviceEntry } = await supertest(admin)
		.post(`/${version}/device`)
		.send({
			belongs_to__application: appId,
			uuid: deviceUuid,
			device_type: deviceType,
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
		getStateV3: async (): Promise<StateV3> => {
			return await getState(device, device.uuid, 'v3');
		},
		patchStateV2: async (devicePatchBody: AnyObject) => {
			await supertest(device)
				.patch(`/device/v2/${device.uuid}/state`)
				.send(devicePatchBody)
				.expect(200);
		},
		patchStateV3: async (devicePatchBody: AnyObject) => {
			await supertest(device)
				.patch(`/device/v3/${device.uuid}/state`)
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
	expect(provisionedDevice.d[0].supervisor_version).to.equal(supervisorVersion);

	return device;
}

export type Device = ResolvableReturnType<typeof provisionDevice>;
