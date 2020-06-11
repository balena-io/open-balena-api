import 'mocha';
import { app } from '../init';
import { expect } from './test-lib/chai';

import * as Bluebird from 'bluebird';
import * as mockery from 'mockery';
import * as fakeDevice from './test-lib/fake-device';
import { supertest, UserObjectParam } from './test-lib/supertest';

import sinon = require('sinon');
import configMock = require('../src/lib/config');
import stateMock = require('../src/lib/device-online-state');
import * as fixtures from './test-lib/fixtures';

const POLL_MSEC = 2000;
const TIMEOUT_SEC = 1;

class StateTracker {
	public states: Dictionary<stateMock.DeviceOnlineStates> = {};

	public stateUpdated = (
		uuid: string,
		newState: stateMock.DeviceOnlineStates,
	) => {
		this.states[uuid] = newState;
	};
}

const tracker = new StateTracker();

// mock the value for the default poll interval...
(configMock as AnyObject)['DEFAULT_SUPERVISOR_POLL_INTERVAL'] = POLL_MSEC;

// mock the value for the timeout grace period...
(configMock as AnyObject)['API_HEARTBEAT_STATE_TIMEOUT_SECONDS'] = TIMEOUT_SEC;

const updateDeviceModel = stateMock.getInstance()['updateDeviceModel'];
stateMock.getInstance()['updateDeviceModel'] = function (
	uuid: string,
	newState: stateMock.DeviceOnlineStates,
) {
	tracker.stateUpdated(uuid, newState);
	return updateDeviceModel.call(this, uuid, newState);
};

// register the mocks...
mockery.registerMock('../src/lib/config', configMock);
mockery.registerMock('../src/lib/device-online-state', stateMock);

const waitFor = async (fn: () => boolean, timeout: number = 10000) => {
	let testLimit = Math.max(timeout, 50) / 50;
	let result = fn();
	while (!result && testLimit > 0) {
		await Bluebird.delay(50);
		testLimit--;
		result = fn();
	}

	if (!result) {
		throw new Error('Timeout waiting for result');
	}
};

describe('Device State v2', () => {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	let device: fakeDevice.Device;

	before(async () => {
		fx = await fixtures.load('03-device-state-v2');

		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(admin, applicationId);
	});

	after(async () => {
		await fixtures.clean(fx);
		mockery.deregisterMock('../src/lib/env-vars');
		mockery.deregisterMock('../src/lib/config');
		mockery.deregisterMock('../src/lib/device-online-state');
	});

	describe(`API heartbeat state`, () => {
		describe('Poll Interval Acquisition', () => {
			it('Should see default value when not overridden', async () => {
				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_MSEC * stateMock.POLL_JITTER_FACTOR);
			});

			it('Should see the application-specific value if one exists', async () => {
				await supertest(app, admin)
					.post('/resin/application_config_variable')
					.send({
						name: 'RESIN_SUPERVISOR_POLL_INTERVAL',
						value: '123000',
						application: applicationId,
					})
					.expect(201);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(123000 * stateMock.POLL_JITTER_FACTOR);
			});

			it('Should see the device-specific value if one exists', async () => {
				await supertest(app, admin)
					.post('/resin/device_config_variable')
					.send({
						name: 'RESIN_SUPERVISOR_POLL_INTERVAL',
						value: '321000',
						device: device.id,
					})
					.expect(201);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(321000 * stateMock.POLL_JITTER_FACTOR);
			});

			it('Should see the default value if the device-specific value is less than it', async () => {
				await supertest(app, admin)
					.patch(
						`/resin/device_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and device eq ${device.id}`,
					)
					.send({
						value: `${POLL_MSEC - 100}`,
					})
					.expect(200);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_MSEC * stateMock.POLL_JITTER_FACTOR);

				await supertest(app, admin)
					.delete(
						`/resin/device_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and device eq ${device.id}`,
					)
					.expect(200);
			});

			it('Should see the default value if the application-specific value is less than it', async () => {
				await supertest(app, admin)
					.patch(
						`/resin/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${applicationId}`,
					)
					.send({
						value: `${POLL_MSEC - 200}`,
					})
					.expect(200);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_MSEC * stateMock.POLL_JITTER_FACTOR);

				await supertest(app, admin)
					.delete(
						`/resin/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${applicationId}`,
					)
					.expect(200);
			});
		});

		describe('Event Tracking', () => {
			const devicePollInterval =
				Math.ceil((POLL_MSEC * stateMock.POLL_JITTER_FACTOR) / 1000) * 1000;

			const stateChangeEventSpy = sinon.spy();
			stateMock.getInstance().on('change', (args) => {
				if (args.uuid !== device.uuid) {
					return;
				}

				stateChangeEventSpy(args);
			});

			it('Should see the stats event emitted more than three times', async () => {
				const statsEventSpy = sinon.spy();
				stateMock.getInstance().on('stats', statsEventSpy);

				await waitFor(() => statsEventSpy.callCount >= 3);

				stateMock.getInstance().off('stats', statsEventSpy);
			});

			it('Should see state initially as "unknown"', async () => {
				const { body } = await supertest(app, admin)
					.get(`/resin/device(${device.id})`)
					.expect(200);

				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'api_heartbeat_state',
					stateMock.DeviceOnlineStates.Unknown,
					'API heartbeat state is not unknown (default)',
				);
			});

			it('Should see state become "online" after a state poll', async () => {
				stateChangeEventSpy.resetHistory();
				await device.getStateV2();

				await waitFor(() => stateChangeEventSpy.called);

				expect(tracker.states[device.uuid]).to.equal(
					stateMock.DeviceOnlineStates.Online,
				);

				const { body } = await supertest(app, admin)
					.get(`/resin/device(${device.id})`)
					.expect(200);

				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'api_heartbeat_state',
					stateMock.DeviceOnlineStates.Online,
					'API heartbeat state is not online',
				);
			});

			it(`Should see state become "timeout" following a delay of ${
				devicePollInterval / 1000
			} seconds`, async () => {
				stateChangeEventSpy.resetHistory();
				await Bluebird.delay(devicePollInterval);

				await waitFor(() => stateChangeEventSpy.called);

				expect(tracker.states[device.uuid]).to.equal(
					stateMock.DeviceOnlineStates.Timeout,
				);

				const { body } = await supertest(app, admin)
					.get(`/resin/device(${device.id})`)
					.expect(200);

				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'api_heartbeat_state',
					stateMock.DeviceOnlineStates.Timeout,
					'API heartbeat state is not timeout',
				);
			});

			it(`Should see state become "online" again, following a state poll`, async () => {
				stateChangeEventSpy.resetHistory();

				await device.getStateV2();

				await waitFor(() => stateChangeEventSpy.called);

				expect(tracker.states[device.uuid]).to.equal(
					stateMock.DeviceOnlineStates.Online,
				);

				const { body } = await supertest(app, admin)
					.get(`/resin/device(${device.id})`)
					.expect(200);

				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'api_heartbeat_state',
					stateMock.DeviceOnlineStates.Online,
					'API heartbeat state is not online',
				);
			});

			it(`Should see state become "offline" following a delay of ${
				TIMEOUT_SEC + devicePollInterval / 1000
			} seconds`, async () => {
				stateChangeEventSpy.resetHistory();

				await Bluebird.delay(devicePollInterval + TIMEOUT_SEC * 1000);

				// it will be called for TIMEOUT and OFFLINE...
				await waitFor(() => stateChangeEventSpy.calledTwice);

				expect(tracker.states[device.uuid]).to.equal(
					stateMock.DeviceOnlineStates.Offline,
				);

				const { body } = await supertest(app, admin)
					.get(`/resin/device(${device.id})`)
					.expect(200);

				expect(body.d[0]).to.not.be.undefined;
				expect(body.d[0]).to.have.property(
					'api_heartbeat_state',
					stateMock.DeviceOnlineStates.Offline,
					'API heartbeat state is not offline',
				);
			});
		});
	});
});

describe('Device State v2 patch', function () {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	let device: fakeDevice.Device;

	before(async () => {
		fx = await fixtures.load('03-device-state-v2');

		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(admin, applicationId);
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('should save the updated device state', async () => {
		const devicePatchBody = {
			local: {
				device_name: 'reported_device_name',
				status: 'Idle',
				is_online: true,
				os_version: 'balenaOS 2.50.1+rev1',
				os_variant: 'prod',
				supervisor_version: '11.4.10',
				provisioning_progress: null,
				provisioning_state: null,
				ip_address: '192.168.1.1',
				mac_address: '00:11:22:33:44:55',
				download_progress: null,
				api_port: 48484,
			},
		};

		await device.patchStateV2(devicePatchBody);

		const {
			body: {
				d: [updatedDevice],
			},
		} = await supertest(app, admin)
			.get(`/resin/device(${device.id})`)
			.expect(200);

		Object.keys(devicePatchBody.local).forEach(
			(field: keyof typeof devicePatchBody['local']) => {
				expect(updatedDevice[field]).to.equal(devicePatchBody.local[field]);
			},
		);
	});
});
