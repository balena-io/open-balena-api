import { expect } from './test-lib/chai';

import * as Bluebird from 'bluebird';
import * as mockery from 'mockery';
import * as fakeDevice from './test-lib/fake-device';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';

import sinon = require('sinon');
import configMock = require('../src/lib/config');
import * as stateMock from '../src/features/device-heartbeat';
import * as fixtures from './test-lib/fixtures';

const POLL_MSEC = 2000;
const TIMEOUT_SEC = 1;

const { DeviceOnlineStates } = stateMock;

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
				await supertest(admin)
					.post(`/${version}/application_config_variable`)
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
				await supertest(admin)
					.post(`/${version}/device_config_variable`)
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
				await supertest(admin)
					.patch(
						`/${version}/device_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and device eq ${device.id}`,
					)
					.send({
						value: `${POLL_MSEC - 100}`,
					})
					.expect(200);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_MSEC * stateMock.POLL_JITTER_FACTOR);

				await supertest(admin)
					.delete(
						`/${version}/device_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and device eq ${device.id}`,
					)
					.expect(200);
			});

			it('Should see the default value if the application-specific value is less than it', async () => {
				await supertest(admin)
					.patch(
						`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${applicationId}`,
					)
					.send({
						value: `${POLL_MSEC - 200}`,
					})
					.expect(200);

				const pollInterval = await stateMock.getPollInterval(device.uuid);
				expect(pollInterval).to.equal(POLL_MSEC * stateMock.POLL_JITTER_FACTOR);

				await supertest(admin)
					.delete(
						`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${applicationId}`,
					)
					.expect(200);
			});
		});

		describe('Event Tracking', () => {
			const devicePollInterval =
				Math.ceil((POLL_MSEC * stateMock.POLL_JITTER_FACTOR) / 1000) * 1000;

			let deviceUserRequestedState: fakeDevice.Device;

			const stateChangeEventSpy = sinon.spy();
			before(async () => {
				deviceUserRequestedState = await fakeDevice.provisionDevice(
					admin,
					applicationId,
				);

				stateMock.getInstance().on('change', (args) => {
					if (
						![device.uuid, deviceUserRequestedState.uuid].includes(args.uuid)
					) {
						return;
					}

					stateChangeEventSpy(args);
				});
			});

			it('Should see the stats event emitted more than three times', async () => {
				const statsEventSpy = sinon.spy();
				stateMock.getInstance().on('stats', statsEventSpy);

				await waitFor(() => statsEventSpy.callCount >= 3);

				stateMock.getInstance().off('stats', statsEventSpy);
			});

			[
				{
					tokenType: 'device API Key',
					getActor: () => device,
					heartbeatAfterGet: DeviceOnlineStates.Online,
					getDevice: () => device,
					getStateV2: () => device.getState(),
				},
				{
					tokenType: 'user token',
					getActor: () => admin,
					heartbeatAfterGet: DeviceOnlineStates.Unknown,
					getDevice: () => deviceUserRequestedState,
					getStateV2: () =>
						fakeDevice.getState(admin, deviceUserRequestedState.uuid),
				},
			].forEach(
				({ tokenType, getActor, heartbeatAfterGet, getDevice, getStateV2 }) => {
					describe(`Given a ${tokenType}`, function () {
						it('Should see state initially as "unknown"', async () => {
							const { body } = await supertest(getActor())
								.get(`/${version}/device(${getDevice().id})`)
								.expect(200);

							expect(body.d[0]).to.not.be.undefined;
							expect(body.d[0]).to.have.property(
								'api_heartbeat_state',
								DeviceOnlineStates.Unknown,
								'API heartbeat state is not unknown (default)',
							);
						});

						it(`Should have the "${heartbeatAfterGet}" heartbeat state after a state poll`, async () => {
							stateChangeEventSpy.resetHistory();
							await getStateV2();

							if (heartbeatAfterGet !== DeviceOnlineStates.Unknown) {
								await waitFor(() => stateChangeEventSpy.called);
							} else {
								await Bluebird.delay(1000);
								expect(stateChangeEventSpy.called).to.be.false;
							}

							expect(tracker.states[getDevice().uuid]).to.equal(
								heartbeatAfterGet !== DeviceOnlineStates.Unknown
									? heartbeatAfterGet
									: undefined,
							);

							const { body } = await supertest(getActor())
								.get(`/${version}/device(${getDevice().id})`)
								.expect(200);

							expect(body.d[0]).to.not.be.undefined;
							expect(body.d[0]).to.have.property(
								'api_heartbeat_state',
								heartbeatAfterGet,
								`API heartbeat state is not ${heartbeatAfterGet}`,
							);
						});

						if (heartbeatAfterGet === DeviceOnlineStates.Unknown) {
							return;
						}

						it(`Should see state become "timeout" following a delay of ${
							devicePollInterval / 1000
						} seconds`, async () => {
							stateChangeEventSpy.resetHistory();
							await Bluebird.delay(devicePollInterval);

							await waitFor(() => stateChangeEventSpy.called);

							expect(tracker.states[getDevice().uuid]).to.equal(
								DeviceOnlineStates.Timeout,
							);

							const { body } = await supertest(getActor())
								.get(`/${version}/device(${getDevice().id})`)
								.expect(200);

							expect(body.d[0]).to.not.be.undefined;
							expect(body.d[0]).to.have.property(
								'api_heartbeat_state',
								DeviceOnlineStates.Timeout,
								'API heartbeat state is not timeout',
							);
						});

						it(`Should see state become "online" again, following a state poll`, async () => {
							stateChangeEventSpy.resetHistory();

							await getStateV2();

							await waitFor(() => stateChangeEventSpy.called);

							expect(tracker.states[getDevice().uuid]).to.equal(
								DeviceOnlineStates.Online,
							);

							const { body } = await supertest(getActor())
								.get(`/${version}/device(${getDevice().id})`)
								.expect(200);

							expect(body.d[0]).to.not.be.undefined;
							expect(body.d[0]).to.have.property(
								'api_heartbeat_state',
								DeviceOnlineStates.Online,
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

							expect(tracker.states[getDevice().uuid]).to.equal(
								DeviceOnlineStates.Offline,
							);

							const { body } = await supertest(getActor())
								.get(`/${version}/device(${getDevice().id})`)
								.expect(200);

							expect(body.d[0]).to.not.be.undefined;
							expect(body.d[0]).to.have.property(
								'api_heartbeat_state',
								DeviceOnlineStates.Offline,
								'API heartbeat state is not offline',
							);
						});
					});
				},
			);
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
		device = await fakeDevice.provisionDevice(
			admin,
			applicationId,
			'balenaOS 2.42.0+rev1',
			'9.11.1',
		);
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
				cpu_usage: 34,
				memory_usage: 1000, // 1GB in MiB
				memory_total: 4000, // 4GB in MiB
				storage_block_device: '/dev/mmcblk0',
				storage_usage: 1000, // 1GB in MiB
				storage_total: 64000, // 64GB in MiB
				cpu_temp: 56,
				is_undervolted: true,
				cpu_id: 'some CPU string',
			},
		};

		await device.patchStateV2(devicePatchBody);

		const {
			body: {
				d: [updatedDevice],
			},
		} = await supertest(admin)
			.get(`/${version}/device(${device.id})`)
			.expect(200);

		Object.keys(devicePatchBody.local).forEach(
			(field: keyof typeof devicePatchBody['local']) => {
				expect(updatedDevice[field], field).to.equal(
					devicePatchBody.local[field],
				);
			},
		);
	});
});
