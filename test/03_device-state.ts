import { sbvrUtils, permissions } from '@balena/pinejs';
import _ from 'lodash';
import sinon from 'sinon';
import { expect } from 'chai';
import * as fakeDevice from './test-lib/fake-device.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import * as config from '../src/lib/config.js';
import {
	DeviceOnlineStates,
	getInstance as getDeviceOnlineStateManager,
	getPollInterval,
	POLL_JITTER_FACTOR,
} from '../src/features/device-heartbeat/index.js';
import { assertExists, itExpectsError, waitFor } from './test-lib/common.js';
import * as fixtures from './test-lib/fixtures.js';
import {
	expectResourceToMatch,
	thatIsDateStringAfter,
} from './test-lib/api-helpers.js';
import { redis, redisRO } from '../src/infra/redis/index.js';
import { setTimeout } from 'timers/promises';
import { MINUTES, SECONDS } from '@balena/env-parsing';
import type { PineTest } from 'pinejs-client-supertest';
import type { PickDeferred } from '@balena/abstract-sql-to-typescript';
import type { Application, Service } from '../src/balena-model.js';

const { api } = sbvrUtils;

const POLL_MSEC = 2000;
const TIMEOUT_SEC = 1;

class StateTracker {
	public states: { [key: number]: DeviceOnlineStates } = {};

	public stateUpdated = (deviceId: number, newState: DeviceOnlineStates) => {
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
	Math.ceil((POLL_MSEC * POLL_JITTER_FACTOR) / 1000) * 1000;

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
				let application: PickDeferred<Application['Read']>;
				let app1service1: AnyObject;
				let app1service2: AnyObject;
				let device: fakeDevice.Device;
				let existingDevice: AnyObject;
				let release1: AnyObject;
				let release1Image1: AnyObject;
				let release1Image2: AnyObject;

				/** Tracks updateDeviceModel() calls */
				const tracker = new StateTracker();
				const updateDeviceModel =
					getDeviceOnlineStateManager()['updateDeviceModel'];

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
					application = fx.applications.app1;
					app1service1 = fx.services.app1_service1;
					app1service2 = fx.services.app1_service2;
					release1 = fx.releases.release1;
					release1Image1 = fx.images.release1_image1;
					release1Image2 = fx.images.release1_image2;

					// create a new device in this test application...
					device = await fakeDevice.provisionDevice(admin, application.id);
					existingDevice = fx.devices.device1;

					getDeviceOnlineStateManager()['updateDeviceModel'] = function (
						deviceId: number,
						newState: DeviceOnlineStates,
					) {
						tracker.stateUpdated(deviceId, newState);
						return updateDeviceModel.call(this, deviceId, newState);
					};
				});

				after(async () => {
					await fixtures.clean(fx);
				});

				describe(`API heartbeat state`, () => {
					describe('Poll Interval Acquisition', () => {
						it('Should see default value when not overridden', async () => {
							const pollInterval = await getPollInterval(device.id);
							expect(pollInterval).to.equal(POLL_MSEC * POLL_JITTER_FACTOR);
						});

						it('Should see the application-specific value if one exists', async () => {
							await supertest(admin)
								.post(`/${version}/application_config_variable`)
								.send({
									name: 'RESIN_SUPERVISOR_POLL_INTERVAL',
									value: '123000',
									application: application.id,
								})
								.expect(201);

							const pollInterval = await getPollInterval(device.id);
							expect(pollInterval).to.equal(123000 * POLL_JITTER_FACTOR);
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

							const pollInterval = await getPollInterval(device.id);
							expect(pollInterval).to.equal(321000 * POLL_JITTER_FACTOR);
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

							const pollInterval = await getPollInterval(device.id);
							expect(pollInterval).to.equal(POLL_MSEC * POLL_JITTER_FACTOR);

							await supertest(admin)
								.delete(
									`/${version}/device_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and device eq ${device.id}`,
								)
								.expect(200);
						});

						it('Should see the default value if the application-specific value is less than it', async () => {
							await supertest(admin)
								.patch(
									`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${application.id}`,
								)
								.send({
									value: `${POLL_MSEC - 200}`,
								})
								.expect(200);

							const pollInterval = await getPollInterval(device.id);
							expect(pollInterval).to.equal(POLL_MSEC * POLL_JITTER_FACTOR);

							await supertest(admin)
								.delete(
									`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${application.id}`,
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
								application.id,
							);

							getDeviceOnlineStateManager().on('change', (args) => {
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
							getDeviceOnlineStateManager().on('stats', statsEventSpy);

							await waitFor({ checkFn: () => statsEventSpy.callCount >= 3 });

							getDeviceOnlineStateManager().off('stats', statsEventSpy);
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
												...(versions.gte(version, 'v7') && {
													changed_api_heartbeat_state_on__date: null,
												}),
											},
										);
									});

									if (versions.lte(version, 'v6')) {
										it('Should not be able to retrieve the changed_api_heartbeat_state_on__date property', async () => {
											const { body } = await pineUser
												.get({
													resource: 'device',
													id: getDevice().id,
												})
												.expect(200);
											expect(body).to.have.property('api_heartbeat_state');
											expect(body).to.not.have.property(
												'changed_api_heartbeat_state_on__date',
											);
										});
									}

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
												...(versions.gte(version, 'v7') && {
													changed_api_heartbeat_state_on__date:
														heartbeatAfterGet === DeviceOnlineStates.Unknown
															? null
															: thatIsDateStringAfter(stateUpdatedAfter),
												}),
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
												...(versions.gte(version, 'v7') && {
													changed_api_heartbeat_state_on__date:
														thatIsDateStringAfter(stateUpdatedAfter),
												}),
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
												...(versions.gte(version, 'v7') && {
													changed_api_heartbeat_state_on__date:
														thatIsDateStringAfter(stateUpdatedAfter),
												}),
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
												...(versions.gte(version, 'v7') && {
													changed_api_heartbeat_state_on__date:
														thatIsDateStringAfter(stateUpdatedAfter),
												}),
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
						let lastApiHeartbeatStateChangeEvent: string | null;

						async function getLastApiHeartbeatStateChangeEvent(
							id: number,
						): Promise<string | null> {
							if (versions.lte(version, 'v6')) {
								return null;
							}
							const { body } = await pineUser
								.get({
									resource: 'device',
									id,
									options: {
										$select: 'changed_api_heartbeat_state_on__date',
									},
								})
								.expect(200);
							assertExists(body);
							return body.changed_api_heartbeat_state_on__date;
						}

						before(async () => {
							device2 = await fakeDevice.provisionDevice(admin, application.id);
							getDeviceOnlineStateManager().on('change', (args) => {
								if (device2.id === args.deviceId) {
									device2ChangeEventSpy(args);
									lastPersistedTimestamp = Date.now();
								}
							});
							await expectResourceToMatch(pineUser, 'device', device2.id, {
								api_heartbeat_state: DeviceOnlineStates.Unknown,
								...(versions.gte(version, 'v7') && {
									changed_api_heartbeat_state_on__date: null,
								}),
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
										...(versions.gte(version, 'v7') && {
											changed_api_heartbeat_state_on__date: (prop) =>
												prop.that.is.a('string'),
										}),
									},
								);

								lastApiHeartbeatStateChangeEvent =
									fetchedDevice.changed_api_heartbeat_state_on__date;
							});

							it('should not update the DB heartbeat on subsequent polls', async () => {
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await setTimeout(1000);
								expect(tracker.states[device2.id]).to.be.undefined;
								expect(device2ChangeEventSpy.called).to.be.false;

								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date:
											lastApiHeartbeatStateChangeEvent,
									}),
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
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date:
											lastApiHeartbeatStateChangeEvent,
									}),
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
										application.id,
									);
									getDeviceOnlineStateManager().on('change', (args) => {
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
										application.id,
									);
									getDeviceOnlineStateManager().on('change', (args) => {
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
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date: thatIsDateStringAfter(
											lastApiHeartbeatStateChangeEvent,
										),
									}),
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
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date:
											lastApiHeartbeatStateChangeEvent,
									}),
								});
							});

							it(`should update the DB heartbeat after the validity period passes`, async () => {
								assertExists(lastPersistedTimestamp);
								await setTimeout(500 + Date.now() - lastPersistedTimestamp);
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await waitFor({ checkFn: () => device2ChangeEventSpy.called });
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date: thatIsDateStringAfter(
											lastApiHeartbeatStateChangeEvent,
										),
									}),
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

							it(`should update the DB heartbeat on every poll, but only change the changed_api_heartbeat_state_on__date the first time`, async () => {
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
											...(versions.gte(version, 'v7') && {
												changed_api_heartbeat_state_on__date:
													i === 0
														? thatIsDateStringAfter(
																lastApiHeartbeatStateChangeEvent,
															)
														: lastApiHeartbeatStateChangeEvent,
											}),
										},
									);
									lastApiHeartbeatStateChangeEvent =
										fetchedDevice.changed_api_heartbeat_state_on__date;
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
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date:
											lastApiHeartbeatStateChangeEvent,
									}),
								});
							});
						});

						describe('When decreasing the API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT', function () {
							before(function () {
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
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date:
											lastApiHeartbeatStateChangeEvent,
									}),
								});
							});

							it(`should update the DB heartbeat after exceeding the new validity period`, async () => {
								assertExists(lastPersistedTimestamp);
								await setTimeout(500 + Date.now() - lastPersistedTimestamp);
								await fakeDevice.getState(device2, device2.uuid, stateVersion);
								await waitFor({ checkFn: () => device2ChangeEventSpy.called });
								await expectResourceToMatch(pineUser, 'device', device2.id, {
									api_heartbeat_state: DeviceOnlineStates.Online,
									...(versions.gte(version, 'v7') && {
										changed_api_heartbeat_state_on__date: thatIsDateStringAfter(
											lastApiHeartbeatStateChangeEvent,
										),
									}),
								});
							});
						});
					});
				});

				describe('state GET results', () => {
					it('should have different level environment variables injected', async () => {
						const state = await fakeDevice.getState(
							admin,
							existingDevice.uuid,
							stateVersion,
						);
						const service1environment = {
							name_img: 'value_img',
							name_app: 'value_app',
							name_svc: 'value_svc',
							name_device: 'value_device',
							name_si: 'value_si',
						};
						const service2environment = {
							name_app: 'value_app',
							name_svc: 'value_app',
							name_device: 'value_device',
							name_si: 'value_device',
							name_si_3: 'value_si_3',
						};

						if (stateVersion === 'v2') {
							expect(state).to.deep.equal({
								local: {
									name: existingDevice.device_name,
									apps: {
										[application.id]: {
											releaseId: release1.id,
											commit: 'deadc0de',
											name: application.app_name,
											services: {
												[app1service1.id]: {
													imageId: release1Image1.id,
													serviceName: app1service1.service_name,
													image: release1Image1.is_stored_at__image_location,
													running: true,
													environment: service1environment,
													labels: {},
												},
												[app1service2.id]: {
													imageId: release1Image2.id,
													serviceName: app1service2.service_name,
													image: release1Image2.is_stored_at__image_location,
													running: true,
													environment: service2environment,
													labels: {},
												},
											},
											networks: {},
											volumes: {},
										},
									},
									config: { RESIN_SUPERVISOR_POLL_INTERVAL: '2000' },
								},
								dependent: { apps: {}, devices: {} },
							});
						} else {
							expect(state).to.deep.equal({
								[existingDevice.uuid]: {
									name: existingDevice.device_name,
									apps: {
										[application.uuid]: {
											id: application.id,
											name: application.app_name,
											is_host: application.is_host,
											class: 'fleet',
											releases: {
												deadc0de: {
													id: release1.id,
													services: {
														app1_service1: {
															id: release1Image1.is_a_build_of__service.__id,
															image_id: release1Image1.id,
															image:
																release1Image1.is_stored_at__image_location,
															environment: service1environment,
															labels: {},
														},
														app1_service2: {
															id: release1Image2.is_a_build_of__service.__id,
															image_id: release1Image2.id,
															image:
																release1Image2.is_stored_at__image_location,
															environment: service2environment,
															labels: {},
														},
													},
												},
											},
										},
									},
									config: {
										RESIN_SUPERVISOR_POLL_INTERVAL: '2000',
									},
								},
							});
						}
					});

					if (stateVersion !== 'v2') {
						it('should get the fleet default state', async function () {
							// Use the same release as the one the devices were pinned to,
							// so that the results are similar w/ devive GETs
							await pineUser
								.patch({
									resource: 'application',
									id: application.id,
									body: {
										should_be_running__release: release1.id,
									},
								})
								.expect(200);

							const { body } = await supertest(admin)
								.get(`/device/${stateVersion}/fleet/${application.uuid}/state`)
								.expect(200);
							expect(body).to.deep.equal({
								[application.uuid]: {
									name: application.app_name,
									apps: {
										[application.uuid]: {
											id: application.id,
											name: application.app_name,
											is_host: application.is_host,
											class: 'fleet',
											releases: {
												deadc0de: {
													id: release1.id,
													services: {
														app1_service1: {
															id: release1Image1.is_a_build_of__service.__id,
															image_id: release1Image1.id,
															image:
																release1Image1.is_stored_at__image_location,
															environment: {
																name_app: 'value_app',
																name_device: 'value_svc',
																name_img: 'value_img',
																name_si: 'value_svc',
																name_svc: 'value_svc',
															},
															labels: {},
														},
														app1_service2: {
															id: release1Image2.is_a_build_of__service.__id,
															image_id: release1Image2.id,
															image:
																release1Image2.is_stored_at__image_location,
															environment: {
																name_app: 'value_app',
																name_device: 'value_app',
																name_si: 'value_app',
																name_svc: 'value_app',
															},
															labels: {},
														},
													},
												},
											},
										},
									},
									config: {
										RESIN_SUPERVISOR_POLL_INTERVAL: '2000',
									},
								},
							});
						});
					}
				});
			}),
		);

		(['v2', 'v3'] as const).forEach((stateVersion) => {
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
				let servicesById: Dictionary<PickDeferred<Service['Read']>>;
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
																servicesById[image.is_a_build_of__service.__id]
																	.service_name,
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

				it('should limit metric values when they exceed safe limit', async () => {
					const testDevice = await fakeDevice.provisionDevice(
						admin,
						applicationId,
						'balenaOS 2.42.0+rev1',
						'9.11.1',
					);
					const patchKey = stateVersion === 'v2' ? 'local' : testDevice.uuid;

					const overLimit = config.METRICS_MAX_INTEGER_VALUE + 1;
					const devicePatchBody = {
						[patchKey]: {
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
							cpu_usage: overLimit,
							cpu_temp: overLimit,
							memory_usage: overLimit,
							memory_total: overLimit,
							storage_block_device: '/dev/mmcblk0',
							storage_usage: overLimit,
							storage_total: overLimit,
							is_undervolted: true,
							cpu_id: 'some CPU string',
						},
					};

					await fakeDevice.patchState(
						testDevice,
						testDevice.uuid,
						devicePatchBody,
						stateVersion,
					);

					// manually force cpu_id toLowerCase before expecting the value
					devicePatchBody[patchKey].cpu_id =
						devicePatchBody[patchKey].cpu_id.toLowerCase();

					// memory_usage should be limited to memory_total while others
					// should be limited to the max value
					devicePatchBody[patchKey].cpu_usage =
						config.METRICS_MAX_INTEGER_VALUE;
					devicePatchBody[patchKey].cpu_temp = config.METRICS_MAX_INTEGER_VALUE;
					devicePatchBody[patchKey].memory_usage =
						config.METRICS_MAX_INTEGER_VALUE;
					devicePatchBody[patchKey].memory_total =
						config.METRICS_MAX_INTEGER_VALUE;
					devicePatchBody[patchKey].storage_usage =
						config.METRICS_MAX_INTEGER_VALUE;
					devicePatchBody[patchKey].storage_total =
						config.METRICS_MAX_INTEGER_VALUE;

					const expectedData =
						stateVersion === 'v2'
							? _.mapKeys(devicePatchBody[patchKey], (_v, key) =>
									key === 'name' ? 'device_name' : key,
								)
							: _.pickBy(
									devicePatchBody[patchKey],
									(_v, key) => key !== 'name',
								);

					await expectResourceToMatch(
						pineUser,
						'device',
						testDevice.id,
						expectedData,
					);
				});

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

				it('should accept ip & mac addresses longer than 2000 & 900 chars respectively and truncate at space delimiters', async () => {
					// Generate valid address strings just shy of 255 chars
					const ipv6Addresses: string[] = [];
					const macAddresses: string[] = [];
					for (let i = 1; i <= 51; i++) {
						ipv6Addresses.push(
							`2001:0db8:3c4d:0015:0000:0000:0000:${i.toString(16).padStart(4, '0')}`,
						);
						macAddresses.push(
							`aa:bb:cc:dd:ee:${i.toString(16).padStart(2, '0')}`,
						);
					}
					const DELIMITER = ' ';
					const patchedIp = ipv6Addresses.join(DELIMITER);
					const patchedMac = macAddresses.join(DELIMITER);
					expect(patchedIp).to.have.length.greaterThan(2000);
					expect(patchedMac).to.have.length.greaterThan(900);
					// Simulate a report with space-separated addresses longer than 255 chars
					const devicePatchBody = {
						[stateKey]: {
							ip_address: patchedIp,
							mac_address: patchedMac,
						},
					};

					await fakeDevice.patchState(
						device,
						device.uuid,
						devicePatchBody,
						stateVersion,
					);

					const validIp = ipv6Addresses.slice(0, 50).join(DELIMITER);
					const validMac = macAddresses.slice(0, 50).join(DELIMITER);
					expect(validIp).to.have.length.lessThanOrEqual(2000);
					expect(validMac).to.have.length.lessThanOrEqual(900);
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
							is_running__release: { __id: r.id },
						});
					}
				});

				if (stateVersion === 'v3') {
					it('should save the update status of the device state', async () => {
						await fakeDevice.patchState(
							device,
							device.uuid,
							{
								[stateKey]: {
									apps: {
										[applicationUuid]: {
											releases: {
												[release1.commit]: {
													update_status: 'downloading',
												},
											},
										},
									},
								},
							},
							stateVersion,
						);

						await expectResourceToMatch(pineUser, 'device', device.id, {
							update_status: 'downloading',
						});

						await fakeDevice.patchState(
							device,
							device.uuid,
							{
								[stateKey]: {
									apps: {
										[applicationUuid]: {
											releases: {
												[release1.commit]: {
													update_status: 'downloading',
												},
												[release2.commit]: {
													update_status: 'rejected',
												},
											},
										},
									},
								},
							},
							stateVersion,
						);

						await expectResourceToMatch(pineUser, 'device', device.id, {
							update_status: 'rejected',
						});
					});
				}
			});
		});
	});
};
