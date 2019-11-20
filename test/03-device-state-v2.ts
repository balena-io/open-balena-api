import test from 'ava';
import './00-init';

import { app } from '../init';
import { expect } from './test-lib/chai';

import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as mockery from 'mockery';
import * as fakeDevice from './test-lib/fake-device';
import supertest = require('./test-lib/supertest');

import { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } from '../src/lib/config';

import stateMock = require('../src/lib/device-online-state');
import configMock = require('../src/lib/config');
import sinon = require('sinon');

const POLL_MSEC = 1000,
	TIMEOUT_MSEC = 1000;

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
(configMock as AnyObject)['API_HEARTBEAT_STATE_TIMEOUT_SECONDS'] = Math.floor(
	TIMEOUT_MSEC / 1000,
);

const updateDeviceModel = stateMock.getInstance()['updateDeviceModel'];
stateMock.getInstance()['updateDeviceModel'] = function(
	uuid: string,
	newState: stateMock.DeviceOnlineStates,
) {
	tracker.stateUpdated(uuid, newState);
	return updateDeviceModel.call(this, uuid, newState);
};

// register the mocks...
mockery.registerMock('../src/lib/config', configMock);
mockery.registerMock('../src/lib/device-online-state', stateMock);

const waitFor = async (fn: Function, timeout: number = 10000) => {
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

let admin: string;
let applicationId: number;
let device: fakeDevice.Device;

test.before(async () => {
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

test.after(async () => {
	await supertest(app, admin)
		.delete(`/resin/application(${applicationId})`)
		.expect(200);

	mockery.deregisterMock('../src/lib/env-vars');
	mockery.deregisterMock('../src/lib/config');
	mockery.deregisterMock('../src/lib/device-online-state');
});

{
	const prefix = 'API heartbeat state poll interval';
	test(`${prefix}: Should see default value when not overridden`, async () => {
		const pollInterval = await stateMock.getPollInterval(device.uuid);
		expect(pollInterval).to.equal(POLL_MSEC * stateMock.POLL_JITTER_FACTOR);
	});

	test(`${prefix}: Should see the application-specific value if one exists`, async () => {
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

	test(`${prefix}: Should see the device-specific value if one exists`, async () => {
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

	test(`${prefix}: Should see the default value if the device-specific value is less than it`, async () => {
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

	test(`${prefix}: Should see the default value if the application-specific value is less than it`, async () => {
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
}

{
	const prefix = 'API heartbeat state event tracking';

	const devicePollInterval =
		Math.ceil((POLL_MSEC * stateMock.POLL_JITTER_FACTOR) / 1000) * 1000;

	const stateChangeEventSpy = sinon.spy();
	stateMock.getInstance().on('change', args => {
		if (args.uuid != device.uuid) {
			return;
		}

		stateChangeEventSpy(args);
	});

	test(`${prefix}: Should see the stats event emitted more than three times`, async () => {
		const statsEventSpy = sinon.spy();
		stateMock.getInstance().on('stats', statsEventSpy);

		await waitFor(() => statsEventSpy.callCount >= 3);

		stateMock.getInstance().off('stats', statsEventSpy);
	});

	test(`${prefix}: Should see state initialy as "unknown"`, async () => {
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

	test(`${prefix}: Should see state become "online" after a state poll`, async () => {
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

	test(`${prefix}: Should see state become "timeout" following a delay of ${devicePollInterval /
		1000} seconds`, async () => {
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

	test(`${prefix}: Should see state become "online" again, following a state poll`, async () => {
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

	test(`${prefix}: Should see state become "offline" following a delay of ${(devicePollInterval +
		TIMEOUT_MSEC) /
		1000} seconds`, async () => {
		stateChangeEventSpy.resetHistory();

		await Bluebird.delay(devicePollInterval + TIMEOUT_MSEC);

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
}
