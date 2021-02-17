import { expect } from 'chai';
import * as randomstring from 'randomstring';
import * as uuid from 'uuid';

import { supertest, UserObjectParam } from './supertest';
import { version } from './versions';

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
		extraContainers?: _.Dictionary<
			DeviceStateApp & {
				type: string;
			}
		>;
	};
	dependent: {
		apps: _.Dictionary<DeviceStateApp>;
		devices: AnyObject;
	};
}

export interface DeviceStateEC {
	local: {
		name?: string;
		supervisor_version?: string;
		config: _.Dictionary<string>;
		apps: _.Dictionary<
			DeviceStateApp & {
				appId: number;
				uuid: string;
				install_type: string;
			}
		>;
	};
	dependent: {
		apps: _.Dictionary<DeviceStateApp>;
		devices: AnyObject;
	};
}

export const getState = async <T extends DeviceState>(
	user: UserObjectParam,
	deviceUuid: string,
	stateVersion: string = 'v2',
): Promise<T> => {
	const { body: state } = await supertest(user)
		.get(`/device/${stateVersion}/${deviceUuid}/state`)
		.expect(200);

	expect(state).to.have.property('local');
	expect(state.local).to.have.property('name');
	expect(state.local).to.have.property('config');

	return state;
};

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

	const deviceUuid = uuid.v4().replace(/\-/g, '').toLowerCase();
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
		getState: async (): Promise<DeviceState> => {
			return await getState(device, device.uuid);
		},
		getStateByUuid: async (): Promise<DeviceStateEC> => {
			return await getState(device, device.uuid, 'v2ec');
		},
		patchStateV2: async (devicePatchBody: AnyObject) => {
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
	expect(provisionedDevice.d[0].supervisor_version).to.equal(supervisorVersion);

	return device;
}

export type Device = ResolvableReturnType<typeof provisionDevice>;
