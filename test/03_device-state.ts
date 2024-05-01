import { sbvrUtils, permissions } from '@balena/pinejs';
import _ from 'lodash';
import mockery from 'mockery';
import sinon from 'sinon';
import { expect } from 'chai';
import * as fakeDevice from './test-lib/fake-device.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import * as config from '../src/lib/config.js';
import * as stateMock from '../src/features/device-heartbeat/index.js';
import { itExpectsError, waitFor } from './test-lib/common.js';
import * as fixtures from './test-lib/fixtures.js';
import {
	expectResourceToMatch,
	thatIsDateStringAfter,
} from './test-lib/api-helpers.js';
import { redis, redisRO } from '../src/infra/redis/index.js';
import { setTimeout } from 'timers/promises';
import { MINUTES, SECONDS } from '@balena/env-parsing';
import type { PineTest } from 'pinejs-client-supertest';

const { api } = sbvrUtils;

const POLL_MSEC = 2000;
const TIMEOUT_SEC = 1;

const { DeviceOnlineStates } = stateMock;

class StateTracker {
	public states: { [key: number]: stateMock.DeviceOnlineStates } = {};

	public stateUpdated = (
		deviceId: number,
		newState: stateMock.DeviceOnlineStates,
	) => {
		this.states[deviceId] = newState;
	};
}

const getHeartbeatWriteCacheKey = (deviceId: number) =>
	`device-online-state:${deviceId}`;

const getHeartbeatWriteCacheState = async (deviceId: number) => {
	const value = await redisRO.get(getHeartbeatWriteCacheKey(deviceId));
	if (typeof value !== 'string') {
		return null;
	}
	return JSON.parse(value);
};

config.TEST_MOCK_ONLY.DEFAULT_SUPERVISOR_POLL_INTERVAL = POLL_MSEC;
config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_TIMEOUT_SECONDS = TIMEOUT_SEC;

const devicePollInterval =
	Math.ceil((POLL_MSEC * stateMock.POLL_JITTER_FACTOR) / 1000) * 1000;

/**
 * The 'get-state' event has to be consumed in a short period of time.
 * If we wait longer, and that's comparable to the POLL_MSEC or TIMEOUT_SEC,
 * we then could end up capturing different heartbeat state changes
 */
const maxGetStateEventConsumptionTimeout = 100;

export default () => {
	versions.test((version, pineTest) => {
		(['v2', 'v3'] as const).forEach((stateVersion) =>
			describe(`Device State ${stateVersion}`, () => {
				let fx: fixtures.Fixtures;
				let pineUser: typeof pineTest;
				let admin: UserObjectParam;
				let applicationId: number;
				let device: fakeDevice.Device;

				/** Tracks updateDeviceModel() calls */
				const tracker = new StateTracker();
				const updateDeviceModel = stateMock.getInstance()['updateDeviceModel'];

				const expectDeviceHeartbeat = async (
					deviceId: number,
					params:
						| string
						| {
								db?: string;
								cache?: string | null;
						  },
				) => {
					const db = typeof params === 'string' ? params : params.db;
					const cache = typeof params === 'string' ? params : params.cache;

					if (db != null) {
						await expectResourceToMatch(pineUser, 'device', deviceId, {
							api_heartbeat_state: db,
						});
					}
					if (cache !== undefined) {
						const actualCacheValue =
							await getHeartbeatWriteCacheState(deviceId);
						if (cache == null) {
							expect(actualCacheValue).to.be.null;
						} else {
							expect(actualCacheValue).to.have.property('currentState', cache);
						}
					}
				};

				before(async () => {
					fx = await fixtures.load('03-device-state');

					admin = fx.users.admin;
					pineUser = pineTest.clone({
						passthrough: {
							user: admin,
						},
					});
					applicationId = fx.applications.app1.id;

					// create a new device in this test application...
					device = await fakeDevice.provisionDevice(admin, applicationId);

					stateMock.getInstance()['updateDeviceModel'] = function (
						deviceId: number,
						newState: stateMock.DeviceOnlineStates,
					) {
						tracker.stateUpdated(deviceId, newState);
						return updateDeviceModel.call(this, deviceId, newState);
					};

					mockery.registerMock('../src/lib/device-online-state', stateMock);
				});

				after(async () => {
					await fixtures.clean(fx);
					mockery.deregisterMock('../src/lib/env-vars');
					mockery.deregisterMock('../src/lib/device-online-state');
				});

				describe(`API heartbeat state`, () => {
					describe('Poll Interval Acquisition', () => {
						it('Should see default value when not overridden', async () => {
							const pollInterval = await stateMock.getPollInterval(device.id);
							expect(pollInterval).to.equal(
								POLL_MSEC * stateMock.POLL_JITTER_FACTOR,
							);
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

							const pollInterval = await stateMock.getPollInterval(device.id);
							expect(pollInterval).to.equal(
								123000 * stateMock.POLL_JITTER_FACTOR,
							);
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

							const pollInterval = await stateMock.getPollInterval(device.id);
							expect(pollInterval).to.equal(
								321000 * stateMock.POLL_JITTER_FACTOR,
							);
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

							const pollInterval = await stateMock.getPollInterval(device.id);
							expect(pollInterval).to.equal(
								POLL_MSEC * stateMock.POLL_JITTER_FACTOR,
							);

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

							const pollInterval = await stateMock.getPollInterval(device.id);
							expect(pollInterval).to.equal(
								POLL_MSEC * stateMock.POLL_JITTER_FACTOR,
							);

							await supertest(admin)
								.delete(
									`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${applicationId}`,
								)
								.expect(200);
						});
					});

					describe('Event Tracking', () => {
						let deviceUserRequestedState: fakeDevice.Device;

						const stateChangeEventSpy = sinon.spy();
						before(async () => {
							deviceUserRequestedState = await fakeDevice.provisionDevice(
								admin,
								applicationId,
							);

							stateMock.getInstance().on('change', (args) => {
								if (
									![device.id, deviceUserRequestedState.id].includes(
										args.deviceId,
									)
								) {
									return;
								}

								stateChangeEventSpy(args);
							});
						});

						it('Should see the stats event emitted more than three times', async () => {
							const statsEventSpy = sinon.spy();
							stateMock.getInstance().on('stats', statsEventSpy);

							await waitFor({ checkFn: () => statsEventSpy.callCount >= 3 });

							stateMock.getInstance().off('stats', statsEventSpy);
						});

						[
							{
								tokenType: 'device API Key',
								getPineActor: () =>
									pineTest.clone({
										passthrough: { user: device },
									}),
								heartbeatAfterGet: DeviceOnlineStates.Online,
								getDevice: () => device,
								getState: () =>
									fakeDevice.getState(device, device.uuid, stateVersion),
							},
							{
								tokenType: 'user token',
								getPineActor: () =>
									pineTest.clone({
										passthrough: { user: admin },
									}),
								heartbeatAfterGet: DeviceOnlineStates.Unknown,
								getDevice: () => deviceUserRequestedState,
								getState: () =>
									fakeDevice.getState(
										admin,
										deviceUserRequestedState.uuid,
										stateVersion,
									),
							},
						].forEach(
							({
								tokenType,
								getPineActor,
								heartbeatAfterGet,
								getDevice,
								getState,
							}) => {
								describe(`Given a ${tokenType}`, function () {
									it('Should see state initially as "unknown"', async () => {
										await expectResourceToMatch(
											getPineActor(),
											'device',
											getDevice().id,
											{
												api_heartbeat_state: DeviceOnlineStates.Unknown,
												last_changed_api_heartbeat_state_on__date: null,
											},
										);
									});

									it(`Should have the "${heartbeatAfterGet}" heartbeat state after a state poll`, async () => {
										stateChangeEventSpy.resetHistory();
										const stateUpdatedAfter = Date.now();
										await getState();

										if (heartbeatAfterGet !== DeviceOnlineStates.Unknown) {
											await waitFor({
												checkFn: () => stateChangeEventSpy.called,
											});
										} else {
											await setTimeout(1000);
											expect(stateChangeEventSpy.called).to.be.false;
										}

										expect(tracker.states[getDevice().id]).to.equal(
											heartbeatAfterGet !== DeviceOnlineStates.Unknown
												? heartbeatAfterGet
												: undefined,
										);

										await expectResourceToMatch(
											getPineActor(),
											'device',
											getDevice().id,
											{
												api_heartbeat_state: heartbeatAfterGet,
												last_changed_api_heartbeat_state_on__date:
													heartbeatAfterGet === DeviceOnlineStates.Unknown
														? null
														: thatIsDateStringAfter(stateUpdatedAfter),
											},
										);
									});

									if (heartbeatAfterGet === DeviceOnlineStates.Unknown) {
										return;
									}

									it(`Should see state become "timeout" following a delay of ${
										devicePollInterval / 1000
									} seconds`, async () => {
										stateChangeEventSpy.resetHistory();
										let stateUpdatedAfter = Date.now();
										await setTimeout(devicePollInterval);

										await waitFor({
											checkFn: () => {
												if (stateChangeEventSpy.called) {
													return true;
												}
												stateUpdatedAfter = Math.max(
													// The 10ms are there to account for concurrency between
													// the spy check and the DB commiting the TX.
													Date.now() - 10,
													stateUpdatedAfter,
												);
												return false;
											},
										});

										expect(tracker.states[getDevice().id]).to.equal(
											DeviceOnlineStates.Timeout,
										);

										await expectResourceToMatch(
											getPineActor(),
											'device',
											getDevice().id,
											{
												api_heartbeat_state: DeviceOnlineStates.Timeout,
												last_changed_api_heartbeat_state_on__date:
													thatIsDateStringAfter(stateUpdatedAfter),
											},
										);
									});

									it(`Should see state become "online" again, following a state poll`, async () => {
										stateChangeEventSpy.resetHistory();
										const stateUpdatedAfter = Date.now();
										await getState();

										await waitFor({
											checkFn: () => stateChangeEventSpy.called,
										});

										expect(tracker.states[getDevice().id]).to.equal(
											DeviceOnlineStates.Online,
										);

										await expectResourceToMatch(
											getPineActor(),
											'device',
											getDevice().id,
											{
												api_heartbeat_state: DeviceOnlineStates.Online,
												last_changed_api_heartbeat_state_on__date:
													thatIsDateStringAfter(stateUpdatedAfter),
											},
										);
									});

									it(`Should see state become "offline" following a delay of ${
										TIMEOUT_SEC + devicePollInterval / 1000
									} seconds`, async () => {
										stateChangeEventSpy.resetHistory();
										let stateUpdatedAfter = Date.now();
										await setTimeout(devicePollInterval + TIMEOUT_SEC * 1000);

										// it will be called for TIMEOUT and OFFLINE...
										await waitFor({
											checkFn: () => {
												if (stateChangeEventSpy.calledTwice) {
													return true;
												}
												stateUpdatedAfter = Math.max(
													// The 10ms are there to account for concurrency between
													// the spy check and the DB commiting the TX.
													Date.now() - 10,
													stateUpdatedAfter,
												);
												return false;
											},
										});

										expect(tracker.states[getDevice().id]).to.equal(
											DeviceOnlineStates.Offline,
										);

										await expectResourceToMatch(
											getPineActor(),
											'device',
											getDevice().id,
											{
												api_heartbeat_state: DeviceOnlineStates.Offline,
												last_changed_api_heartbeat_state_on__date:
													thatIsDateStringAfter(stateUpdatedAfter),
											},
										);
									});
								});
							},
						);

						describe('given an expired device api key', function () {
							before(async function () {
								await api.resin.patch({
									resource: 'api_key',
									passthrough: {
										req: permissions.root,
									},
									id: {
										key: device.token,
									},
									body: {
										expiry_date: Date.now() - 60_000,
									},
								});
							});

							it(`should not account state polls as heartbeats`, async () => {
								stateChangeEventSpy.resetHistory();

								await supertest(device)
									.get(`/device/${stateVersion}/${device.uuid}/state`)
									.expect(401);

								await setTimeout(1000);
								expect(stateChangeEventSpy.notCalled).to.equal(
									true,
									`The stateChangeEventSpy shouldn't have been called.`,
								);

								expect(tracker.states[device.id]).to.equal(
									DeviceOnlineStates.Offline,
								);

								await expectResourceToMatch(pineUser, 'device', device.id, {
									api_heartbeat_state: DeviceOnlineStates.Offline,
								});
							});

							it(`should see state become "online" again following a state poll after removing the expiry date from the api key`, async () => {
								stateChangeEventSpy.resetHistory();

								await api.resin.patch({
									resource: 'api_key',
									passthrough: {
										req: permissions.root,
									},
									id: {
										key: device.token,
									},
									body: {
										expiry_date: null,
									},
								});

								await fakeDevice.getState(device, device.uuid, stateVersion);

								await waitFor({
									checkFn: () => stateChangeEventSpy.called,
								});

								expect(tracker.states[device.id]).to.equal(
									DeviceOnlineStates.Online,
								);

								await expectResourceToMatch(pineUser, 'device', device.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
								});
							});
						});
					});

					describe('Online Update Cache', () => {
						let device2: fakeDevice.Device;
						const device2ChangeEventSpy = sinon.spy();
						let lastPersistedTimestamp: number | undefined;
						let lastApiHeartbeatStateChangeEvent: string | null = null;

						async function getLastApiHeartbeatStateChangeEvent(
							id: number,
						): Promise<string | null> {
							return (
								await pineUser
									.get({
										resource: 'device',
										id,
										options: {
											$select: 'last_changed_api_heartbeat_state_on__date',
										},
									})
									.expect(200)
							).body.last_changed_api_heartbeat_state_on__date;
						}

						before(async () => {
							device2 = await fakeDevice.provisionDevice(admin, applicationId);
							stateMock.getInstance().on('change', (args) => {
								if (device2.id === args.deviceId) {
									device2ChangeEventSpy(args);
									lastPersistedTimestamp = Date.now();
								}
							});
							await expectResourceToMatch(pineUser, 'device', device2.id, {
								api_heartbeat_state: DeviceOnlineStates.Unknown,
								last_changed_api_heartbeat_state_on__date: null,
							});
						});
						beforeEach(function () {
							device2ChangeEventSpy.resetHistory();
							delete tracker.states[device2.id];
						});

						describe('When API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT = null', function () {
							before(function () {
								config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT =
									null;
							});

							it('The initial state poll should update the DB heartbeat to Online', async () => {
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await waitFor({ checkFn: () => device2ChangeEventSpy.called });
								const fetchedDevice = await expectResourceToMatch(
									pineUser,
									'device',
									device2.id,
									{
										api_heartbeat_state: DeviceOnlineStates.Online,
										last_changed_api_heartbeat_state_on__date: (prop) =>
											prop.that.is.a('string'),
									},
								);

								lastApiHeartbeatStateChangeEvent =
									fetchedDevice.last_changed_api_heartbeat_state_on__date;
							});

							it('should not update the DB heartbeat on subsequent polls', async () => {
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await setTimeout(1000);
								expect(tracker.states[device2.id]).to.be.undefined;
								expect(device2ChangeEventSpy.called).to.be.false;

								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									last_changed_api_heartbeat_state_on__date:
										lastApiHeartbeatStateChangeEvent,
								});
							});

							it('will trust Redis and not update the DB heartbeat on subsequent polls even if the DB has diverged :(', async () => {
								await pineUser.patch({
									resource: 'device',
									id: device2.id,
									body: {
										api_heartbeat_state: DeviceOnlineStates.Offline,
									},
								});
								lastApiHeartbeatStateChangeEvent =
									await getLastApiHeartbeatStateChangeEvent(device2.id);

								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await setTimeout(1000);
								expect(tracker.states[device2.id]).to.be.undefined;
								expect(device2ChangeEventSpy.called).to.be.false;
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Offline,
									last_changed_api_heartbeat_state_on__date:
										lastApiHeartbeatStateChangeEvent,
								});
							});

							// Here we test how the heartbeat behaves when the write cache has expired (eg b/c of downtime) and when the API starts working again,
							// the first state GET request that we receive for a device happens while its heartbeat has switched to Timeout
							// (the stale redis queued message to switch to Timeout has been consumed, and one to go Offline has been scheduled).
							describe('when the write cache expires while the device is on Timeout (eg API stops serving requests)', function () {
								let device3: fakeDevice.Device;
								const device3ChangeEventSpy = sinon.spy();

								before(async function () {
									// Provision a device and wait for its heartbeat to be Online
									device3 = await fakeDevice.provisionDevice(
										admin,
										applicationId,
									);
									stateMock.getInstance().on('change', (args) => {
										if (device3.id === args.deviceId) {
											device3ChangeEventSpy(args);
										}
									});
									await fakeDevice.getState(
										device3,
										device3.uuid,
										stateVersion,
									);
									await waitFor({
										checkFn: () => device3ChangeEventSpy.called,
									});
									device3ChangeEventSpy.resetHistory();
									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Online,
										cache: DeviceOnlineStates.Online,
									});

									// Wait until the heartbeat switches to Timeout (heartbeatTimeoutChangeInterval).
									await waitFor({
										checkFn: () => device3ChangeEventSpy.called,
									});
									device3ChangeEventSpy.resetHistory();
									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Timeout,
										cache: DeviceOnlineStates.Timeout,
									});

									// emulate the write cache having expired while the redis message queue hasn't been processed
									// eg b/c the API/DB was down.
									await redis.del(getHeartbeatWriteCacheKey(device3.id));
								});

								beforeEach(function () {
									device3ChangeEventSpy.resetHistory();
									delete tracker.states[device3.id];
								});

								itExpectsError(
									'should turn Online and not consume the stale heartbeat redis queue message when a newer state GET has arrived',
									async function () {
										await fakeDevice.getState(
											device3,
											device3.uuid,
											stateVersion,
										);
										// The write cache has expired so the DB's heartbeat gets updated
										await waitFor({
											maxWait: maxGetStateEventConsumptionTimeout,
											checkFn: () => device3ChangeEventSpy.called,
										});

										// Confirm that a state GET after the downtime does switch the device to Online
										// and sets that to the write cache.
										await expectDeviceHeartbeat(device3.id, {
											db: DeviceOnlineStates.Online,
											cache: DeviceOnlineStates.Online,
										});

										// Wait for the stale (TIMEOUT -> OFFLINE) message queue item to get consumed.
										await setTimeout(TIMEOUT_SEC * 1000 + 1000);

										// it's expected that the write cache gets cleared when the DB switches to offline
										expect(await getHeartbeatWriteCacheState(device3.id)).to.be
											.null;

										await expectResourceToMatch(
											pineUser,
											'device',
											device3.id,
											{
												// We use the same description as in the itExpectsError, so that we are sure which part failed.
												api_heartbeat_state: (prop, value) =>
													prop.to.equal(
														DeviceOnlineStates.Online,
														`The api_heartbeat_state should have become online but it was found ${value}`,
													),
											},
										);
									},
									/The api_heartbeat_state should have become online but it was found offline/,
								);

								it('should switch to Online after a subsequent state GET and not stay stuck as offline forever', async function () {
									// Confirm that we are in he case that the DB says Offline & the write Cache is cleared up
									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Offline,
										cache: null,
									});

									await fakeDevice.getState(
										device3,
										device3.uuid,
										stateVersion,
									);
									await waitFor({
										maxWait: maxGetStateEventConsumptionTimeout,
										checkFn: () => device3ChangeEventSpy.called,
									});
									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Online,
										cache: DeviceOnlineStates.Online,
									});
								});
							});

							// Here we test how the heartbeat behaves when the write cache has expired (eg b/c of downtime) and when the API starts working again,
							// the first state GET request that we receive for a device happens while its heartbeat is still Online
							// (the stale redis queued message to switch to Timeout has not yet be consumed).
							describe('when the write cache expires while the device is Online (eg API stops serving requests)', function () {
								let device3: fakeDevice.Device;
								const device3ChangeEventSpy = sinon.spy();

								before(async function () {
									device3 = await fakeDevice.provisionDevice(
										admin,
										applicationId,
									);
									stateMock.getInstance().on('change', (args) => {
										if (device3.id === args.deviceId) {
											device3ChangeEventSpy(args);
										}
									});
									await fakeDevice.getState(
										device3,
										device3.uuid,
										stateVersion,
									);
									await waitFor({
										checkFn: () => device3ChangeEventSpy.called,
									});

									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Online,
										cache: DeviceOnlineStates.Online,
									});
									// emulate the write cache having expired while the redis message queue hasn't been processed
									// eg b/c the API/DB was down.
									await redis.del(getHeartbeatWriteCacheKey(device3.id));
								});

								beforeEach(function () {
									device3ChangeEventSpy.resetHistory();
									delete tracker.states[device3.id];
								});

								itExpectsError(
									'should stay Online and not consume the stale heartbeat redis queue message when a newer state GET has arrived',
									async function () {
										// The initialWait needs to be near the end of the devicePollInterval, so that
										// * we make a state GET request before the Online->Timeout queued message gets consumed, so that
										// * the new write cache item created by the state GET, will still be not expired when the stale (created in the before())
										// heartbeat change queued messages get fully consumed,
										const initialWait = 0.8 * devicePollInterval;
										await setTimeout(initialWait);
										// confirm that the device is still online after the wait and there was no state change
										await expectDeviceHeartbeat(device3.id, {
											db: DeviceOnlineStates.Online,
											cache: null,
										});
										expect(device3ChangeEventSpy.called).to.be.false;

										// Confirm that a state GET after the downtime, does switch the device to Online
										await fakeDevice.getState(
											device3,
											device3.uuid,
											stateVersion,
										);
										await waitFor({
											maxWait: maxGetStateEventConsumptionTimeout,
											checkFn: () => device3ChangeEventSpy.called,
										});
										await expectDeviceHeartbeat(device3.id, {
											db: DeviceOnlineStates.Online,
											cache: DeviceOnlineStates.Online,
										});

										// Wait long enough for the stale (ONLINE -> TIMEOUT) & (TIMEOUT -> OFFLINE) message queue items to get consumed.
										// TODO: This is only testing the current state and shouldn't be happening.
										await setTimeout(
											devicePollInterval -
												initialWait +
												TIMEOUT_SEC * 1000 +
												1000,
										);
										await expectResourceToMatch(
											pineUser,
											'device',
											device3.id,
											{
												// We use the same description as in the itExpectsError, so that we are sure which part failed.
												api_heartbeat_state: (prop, value) =>
													prop.to.equal(
														DeviceOnlineStates.Online,
														`The api_heartbeat_state should have become online but it was found ${value}`,
													),
											},
										);
										expect(
											await getHeartbeatWriteCacheState(device3.id),
										).to.have.property('currentState', 'online');
									},
									/The api_heartbeat_state should have become online but it was found offline/,
								);

								// This tests that when the above race condition is hit, devices will correctly switch to Online after the next state GET,
								// instead of being stuck forever.
								// TODO: We should be able to drop this once the ^ test gets fixed.
								it('should switch to Online after a subsequent state GET and not stay stuck to Offline forever', async function () {
									// Confirm that we are in he case that the DB says Offline & the write Cache is cleared up
									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Offline,
										cache: null,
									});

									await fakeDevice.getState(
										device3,
										device3.uuid,
										stateVersion,
									);
									await waitFor({
										maxWait: maxGetStateEventConsumptionTimeout,
										checkFn: () => device3ChangeEventSpy.called,
									});
									await expectDeviceHeartbeat(device3.id, {
										db: DeviceOnlineStates.Online,
										cache: DeviceOnlineStates.Online,
									});
								});
							});
						});

						describe('When API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT = 2 seconds', function () {
							before(async function () {
								config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT =
									2 * SECONDS;
								// Set a different value to make sure that it indeed gets updated
								await pineUser.patch({
									resource: 'device',
									id: device2.id,
									body: {
										api_heartbeat_state: DeviceOnlineStates.Unknown,
									},
								});
								lastApiHeartbeatStateChangeEvent =
									await getLastApiHeartbeatStateChangeEvent(device2.id);
							});

							it('should update the DB heartbeat on the first request that finds the ttl being null', async () => {
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await waitFor({ checkFn: () => device2ChangeEventSpy.called });
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									last_changed_api_heartbeat_state_on__date:
										thatIsDateStringAfter(lastApiHeartbeatStateChangeEvent),
								});
							});

							it(`should not update the DB heartbeat on the subsequent polls within the validity period`, async () => {
								// Set a different value to make sure that it indeed gets updated
								await pineUser.patch({
									resource: 'device',
									id: device2.id,
									body: {
										api_heartbeat_state: DeviceOnlineStates.Unknown,
									},
								});
								lastApiHeartbeatStateChangeEvent =
									await getLastApiHeartbeatStateChangeEvent(device2.id);

								for (let i = 0; i < 3; i++) {
									await fakeDevice.getState(
										device2,
										device2.uuid,
										stateVersion,
									);
								}
								await setTimeout(1000);
								expect(tracker.states[device2.id]).to.be.undefined;
								expect(device2ChangeEventSpy.called).to.be.false;
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Unknown,
									last_changed_api_heartbeat_state_on__date:
										lastApiHeartbeatStateChangeEvent,
								});
							});

							it(`should update the DB heartbeat after the validity period passes`, async () => {
								await setTimeout(500 + Date.now() - lastPersistedTimestamp!);
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await waitFor({ checkFn: () => device2ChangeEventSpy.called });
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									last_changed_api_heartbeat_state_on__date:
										thatIsDateStringAfter(lastApiHeartbeatStateChangeEvent),
								});
							});
						});

						describe('When API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT = 0', function () {
							before(async function () {
								config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT = 0;
								// Set a different value to make sure that it indeed gets updated
								await pineUser.patch({
									resource: 'device',
									id: device2.id,
									body: {
										api_heartbeat_state: DeviceOnlineStates.Unknown,
									},
								});
								lastApiHeartbeatStateChangeEvent =
									await getLastApiHeartbeatStateChangeEvent(device2.id);
							});

							it(`should update the DB heartbeat on every poll, but only change the last_changed_api_heartbeat_state_on__date the first time`, async () => {
								for (let i = 0; i < 3; i++) {
									await fakeDevice.getState(
										device2,
										device2.uuid,
										stateVersion,
									);
									await waitFor({
										checkFn: () => device2ChangeEventSpy.called,
									});
									device2ChangeEventSpy.resetHistory();
									const fetchedDevice = await expectResourceToMatch(
										pineUser,
										'device',
										device2.id,
										{
											api_heartbeat_state: DeviceOnlineStates.Online,
											last_changed_api_heartbeat_state_on__date:
												i === 0
													? thatIsDateStringAfter(
															lastApiHeartbeatStateChangeEvent,
														)
													: lastApiHeartbeatStateChangeEvent,
										},
									);
									lastApiHeartbeatStateChangeEvent =
										fetchedDevice.last_changed_api_heartbeat_state_on__date;
								}
							});
						});

						describe('When increasing the API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT', function () {
							before(async function () {
								config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT =
									1 * MINUTES;
								// Set a different value to make sure that it indeed gets updated
								await pineUser.patch({
									resource: 'device',
									id: device2.id,
									body: {
										api_heartbeat_state: DeviceOnlineStates.Unknown,
									},
								});
								lastApiHeartbeatStateChangeEvent =
									await getLastApiHeartbeatStateChangeEvent(device2.id);
							});

							it(`should not update the DB heartbeat on polls within the validity period`, async () => {
								for (let i = 0; i < 3; i++) {
									await fakeDevice.getState(
										device2,
										device2.uuid,
										stateVersion,
									);
								}
								await setTimeout(500);
								expect(tracker.states[device2.id]).to.be.undefined;
								expect(device2ChangeEventSpy.called).to.be.false;
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Unknown,
									last_changed_api_heartbeat_state_on__date:
										lastApiHeartbeatStateChangeEvent,
								});
							});
						});

						describe('When decreasing the API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT', function () {
							before(async function () {
								config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT =
									2 * SECONDS;
							});

							it(`should not update the DB heartbeat on polls within the new validity period`, async () => {
								for (let i = 0; i < 3; i++) {
									await fakeDevice.getState(
										device2,
										device2.uuid,
										stateVersion,
									);
								}
								await setTimeout(500);
								expect(tracker.states[device2.id]).to.be.undefined;
								expect(device2ChangeEventSpy.called).to.be.false;
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Unknown,
									last_changed_api_heartbeat_state_on__date:
										lastApiHeartbeatStateChangeEvent,
								});
							});

							it(`should update the DB heartbeat after exceeding the new validity period`, async () => {
								await setTimeout(500 + Date.now() - lastPersistedTimestamp!);
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await waitFor({ checkFn: () => device2ChangeEventSpy.called });
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									last_changed_api_heartbeat_state_on__date:
										thatIsDateStringAfter(lastApiHeartbeatStateChangeEvent),
								});
							});
						});
					});
				});
			}),
		);

		(['v2', 'v3'] as const).forEach((stateVersion) =>
			describe(`Device State ${stateVersion} patch`, function () {
				let fx: fixtures.Fixtures;
				let admin: UserObjectParam;
				let pineUser: PineTest;
				let applicationId: number;
				let applicationUuid: string;
				let release1: AnyObject;
				let release2: AnyObject;
				let release1Image1: AnyObject;
				let release1Image2: AnyObject;
				let servicesById: Dictionary<AnyObject>;
				let device: fakeDevice.Device;
				let stateKey: string;
				const getMetricsRecentlyUpdatedCacheKey = (uuid: string) =>
					`cache$$lastMetricsReportTime$${uuid}`;

				before(async () => {
					fx = await fixtures.load('03-device-state');

					admin = fx.users.admin;
					applicationUuid = fx.applications.app1.uuid;
					applicationId = fx.applications.app1.id;
					release1 = fx.releases.release1;
					release2 = fx.releases.release2;
					release1Image1 = fx.images.release1_image1;
					release1Image2 = fx.images.release1_image2;
					servicesById = _.keyBy(Object.values(fx.services), 'id');
					pineUser = pineTest.clone({
						passthrough: { user: admin },
					});

					// create a new device in this test application...
					device = await fakeDevice.provisionDevice(
						admin,
						applicationId,
						'balenaOS 2.42.0+rev1',
						'9.11.1',
					);

					stateKey = stateVersion === 'v2' ? 'local' : device.uuid;
				});

				after(async () => {
					await fixtures.clean(fx);
				});

				const getServiceUpdatePatchBody = (
					images: AnyObject[],
					{
						status = 'Downloading',
						download_progress,
					}: {
						status?: string;
						download_progress: number;
					},
				) => {
					return {
						[stateKey]:
							stateVersion === 'v2'
								? {
										apps: images.map((image) => ({
											services: {
												[image.id]: {
													releaseId: release1.id,
													status,
													download_progress,
												},
											},
										})),
									}
								: {
										apps: {
											[applicationUuid]: {
												releases: {
													[release1.commit]: {
														services: Object.fromEntries(
															images.map((image) => [
																servicesById[image.is_a_build_of__service.__id],
																{
																	image: image.is_stored_at__image_location,
																	status,
																	download_progress,
																},
															]),
														),
													},
												},
											},
										},
									},
					};
				};

				it('should save the updated device state', async () => {
					const devicePatchBody = {
						[stateKey]: {
							name: 'reported_device_name',
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
							cpu_temp: 56,
							memory_usage: 1000, // 1GB in MiB
							memory_total: 4000, // 4GB in MiB
							storage_block_device: '/dev/mmcblk0',
							storage_usage: 1000, // 1GB in MiB
							storage_total: 64000, // 64GB in MiB
							is_undervolted: true,
							cpu_id: 'some CPU string',
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBody,
						stateVersion,
					);

					// manually force cpu_id toLowerCase before expecting the value
					devicePatchBody[stateKey].cpu_id =
						devicePatchBody[stateKey].cpu_id.toLowerCase();

					const expectedData =
						stateVersion === 'v2'
							? _.mapKeys(devicePatchBody[stateKey], (_v, key) =>
									key === 'name' ? 'device_name' : key,
								)
							: _.pickBy(
									devicePatchBody[stateKey],
									(_v, key) => key !== 'name',
								);

					await expectResourceToMatch(
						pineUser,
						'device',
						device.id,
						expectedData,
					);
				});

				it('should not save an invalid CPU ID', async () => {
					const devicePatchBodyCorrect = {
						[stateKey]: {
							name: 'correctCPUID',
							cpu_id: '\x20\x7e',
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBodyCorrect,
						stateVersion,
					);

					const devicePatchBodyInvalid = {
						[stateKey]: {
							name: 'invalidCPUID',
							cpu_id: '\x19\x80',
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBodyInvalid,
						stateVersion,
					);

					devicePatchBodyInvalid[stateKey].cpu_id = '\x20\x7e';
					const expectedData =
						stateVersion === 'v2'
							? _.mapKeys(devicePatchBodyInvalid[stateKey], (_v, key) =>
									key === 'name' ? 'device_name' : key,
								)
							: _.pickBy(
									devicePatchBodyInvalid[stateKey],
									(_v, key) => key !== 'name',
								);

					await expectResourceToMatch(
						pineUser,
						'device',
						device.id,
						expectedData,
					);
				});

				it('should accept addresses longer than 255 chars and truncate at space delimiters', async () => {
					const generateValidAddress = (
						addr: string,
						truncLen: number,
						delimiter: string = '',
					): string => {
						let validAddress = '';
						while (
							validAddress.length + addr.length + delimiter.length <=
							truncLen
						) {
							validAddress += addr + delimiter;
						}
						return validAddress.trim();
					};
					const IP = '10.0.0.10';
					const MAC = 'aa:bb:cc:dd:ee:ff';
					const DELIMITER = ' ';
					// Generate valid address strings just shy of 255 chars
					const validIp = generateValidAddress(IP, 255, DELIMITER);
					const validMac = generateValidAddress(MAC, 255, DELIMITER);
					// Simulate a report with space-separated addresses longer than 255 chars
					const devicePatchBody = {
						[stateKey]: {
							ip_address: validIp + DELIMITER + IP,
							mac_address: validMac + DELIMITER + MAC,
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBody,
						stateVersion,
					);

					// Addresses should truncate at the space delimiter
					await expectResourceToMatch(pineUser, 'device', device.id, {
						ip_address: validIp,
						mac_address: validMac,
					});
				});

				it('should set the metrics throttling key in redis', async () => {
					const cachedValue = await redisRO.get(
						getMetricsRecentlyUpdatedCacheKey(device.uuid),
					);
					expect(cachedValue).to.be.a('string');
					expect(cachedValue?.startsWith('1')).to.be.true;
				});

				it('should throttle metrics-only device state updates [same-instance]', async () => {
					const devicePatchBody = {
						[stateKey]: {
							cpu_usage: 90,
							cpu_temp: 90,
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBody,
						stateVersion,
					);
					await setTimeout(200);

					await expectResourceToMatch(pineUser, 'device', device.id, {
						cpu_usage: 34,
						cpu_temp: 56,
					});
				});

				it('should clear the throttling key from redis after the throttling window passes', async () => {
					await setTimeout(config.METRICS_MAX_REPORT_INTERVAL_SECONDS * 1000);
					expect(
						await redisRO.get(getMetricsRecentlyUpdatedCacheKey(device.uuid)),
					).to.be.null;
				});

				it('should apply metrics-only device state updates when outside the throttling window', async () => {
					const devicePatchBody = {
						[stateKey]: {
							cpu_usage: 20,
							cpu_temp: 20,
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBody,
						stateVersion,
					);

					await expectResourceToMatch(
						pineUser,
						'device',
						device.id,
						devicePatchBody[stateKey],
					);
				});

				it('should throttle metrics-only device state updates [cross-instance]', async () => {
					// Wait for the local cache to expire
					await setTimeout(config.METRICS_MAX_REPORT_INTERVAL_SECONDS * 1000);
					// confirm that even the redis cache has expired
					expect(
						await redisRO.get(getMetricsRecentlyUpdatedCacheKey(device.uuid)),
					).to.be.null;
					const now = `${Date.now()}`;
					// emulate the creation of a throttling key in redis from a different instance
					await redis.set(getMetricsRecentlyUpdatedCacheKey(device.uuid), now);
					expect(
						await redisRO.get(getMetricsRecentlyUpdatedCacheKey(device.uuid)),
					).to.equal(now);

					const devicePatchBody = {
						[stateKey]: {
							cpu_usage: 90,
							cpu_temp: 90,
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBody,
						stateVersion,
					);

					await expectResourceToMatch(pineUser, 'device', device.id, {
						cpu_usage: 20,
						cpu_temp: 20,
					});
				});

				it('should save the update progress of the device state', async () => {
					await fakeDevice.patchState(
						device,
						device.uuid,
						getServiceUpdatePatchBody([release1Image1, release1Image2], {
							download_progress: 20,
						}),
						stateVersion,
					);

					await expectResourceToMatch(pineUser, 'device', device.id, {
						overall_progress: 20,
					});

					await fakeDevice.patchState(
						device,
						device.uuid,
						getServiceUpdatePatchBody([release1Image1, release1Image2], {
							download_progress: 50,
						}),
						stateVersion,
					);

					await expectResourceToMatch(pineUser, 'device', device.id, {
						overall_progress: 50,
					});
				});

				it('should save the updated running release of the device state', async () => {
					for (const r of [release1, release2]) {
						const devicePatchBody = {
							[stateKey]:
								stateVersion === 'v2'
									? {
											is_on__commit: r.commit,
										}
									: {
											apps: {
												[applicationUuid]: {
													release_uuid: r.commit,
												},
											},
										},
						};

						await fakeDevice.patchState(
							device,
							device.uuid,
							devicePatchBody,
							stateVersion,
						);

						await expectResourceToMatch(pineUser, 'device', device.id, {
							is_running__release: (prop) =>
								prop.that.is.an('object').that.has.property('__id', r.id),
						});
					}
				});
			}),
		);
	});
};
