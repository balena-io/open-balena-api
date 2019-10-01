import 'mocha';
import { app } from '../init';
import { expect } from './test-lib/chai';

import * as Bluebird from 'bluebird';
import * as mockery from 'mockery';
import * as fakeDevice from './test-lib/fake-device';
import supertest = require('./test-lib/supertest');

import { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } from '../src/lib/config';

import stateMock = require('../src/lib/device-online-state');
import configMock = require('../src/lib/config');
import envMock = require('../src/lib/env-vars');

const POLL_SEC = 3,
	TIMEOUT_SEC = 3;

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
(envMock as AnyObject)['DEFAULT_SUPERVISOR_POLL_INTERVAL'] = POLL_SEC * 1000;

// mock the value for the timeout grace period...
(configMock as AnyObject)['API_HEARTBEAT_STATE_TIMEOUT_SECONDS'] = TIMEOUT_SEC;

// mock the device state lib to hook the update of Pine models...
const updateDeviceModel: Function = (stateMock.manager as AnyObject)[
	'updateDeviceModel'
];
(stateMock.manager as AnyObject)['updateDeviceModel'] = (
	uuid: string,
	newState: stateMock.DeviceOnlineStates,
) => {
	tracker.stateUpdated(uuid, newState);
	return updateDeviceModel(uuid, newState);
};

// register the mocks...
mockery.registerMock('../src/lib/env-vars', envMock);
mockery.registerMock('../src/lib/config', configMock);
mockery.registerMock('../src/lib/device-online-state', stateMock);

describe('Device State v2', () => {
	let admin: string;
	let applicationId: number;
	let device: fakeDevice.Device;

	before(async () => {
		// login as the superuser...
		let { text: token } = await supertest(app)
			.post('/login_')
			.send({
				username: SUPERUSER_EMAIL,
				password: SUPERUSER_PASSWORD,
			})
			.expect(200);

		expect(token).to.be.a('string');
		admin = token;

		// create a new test application...
		const { body: application } = await supertest(app, admin)
			.post('/resin/application')
			.send({
				device_type: 'intel-nuc',
				app_name: 'test-app-1',
			})
			.expect(201);

		applicationId = application.id;

		// create a new device in this test application...
		device = await fakeDevice.provisionDevice(admin, applicationId);
	});

	after(async () => {
		await supertest(app, admin)
			.delete(`/resin/application(${applicationId})`)
			.expect(200);

		mockery.deregisterMock('../src/lib/env-vars');
		mockery.deregisterMock('../src/lib/config');
		mockery.deregisterMock('../src/lib/device-online-state');
	});

	describe(`API heartbeat state`, () => {
		describe('Poll Interval Acquisition', () => {
			it('Should see default value when not overridden', async () => {
				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_SEC * 1000);
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
				expect(pollInterval).to.equal(123000);
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
				expect(pollInterval).to.equal(321000);
			});

			it('Should see the default value if the device-specific value is less than it', async () => {
				await supertest(app, admin)
					.patch(
						`/resin/device_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and device eq ${device.id}`,
					)
					.send({
						value: `${POLL_SEC * 1000 - 100}`,
					})
					.expect(200);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_SEC * 1000);

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
						value: `${POLL_SEC * 1000 - 200}`,
					})
					.expect(200);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_SEC * 1000);

				await supertest(app, admin)
					.delete(
						`/resin/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${applicationId}`,
					)
					.expect(200);
			});
		});

		describe('Event Tracking', () => {
			it('Should see state initialy as "unknown"', async () => {
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
				await device.getStateV2();

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

			it(`Should see state become "timeout" following a delay of ${POLL_SEC} seconds (plus 1 second to be sure)`, async () => {
				await Bluebird.delay((POLL_SEC + 1) * 1000);

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
				await device.getStateV2();

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

			it(`Should see state become "offline" following a delay of ${POLL_SEC +
				TIMEOUT_SEC} seconds (plus 1 second to be sure)`, async () => {
				await Bluebird.delay((POLL_SEC + TIMEOUT_SEC + 1) * 1000);
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
