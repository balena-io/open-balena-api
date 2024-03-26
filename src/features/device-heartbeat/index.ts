import { EventEmitter } from 'eventemitter3';
import _ from 'lodash';
import RedisSMQ from 'rsmq';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { captureException } from '../../infra/error-handling/index.js';
import { isApiKeyWithRole } from '../api-keys/lib.js';

import { events as deviceStateEvents } from '../device-state/index.js';

import {
	API_HEARTBEAT_STATE_ENABLED,
	API_HEARTBEAT_STATE_TIMEOUT_SECONDS,
	API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT,
	DEFAULT_SUPERVISOR_POLL_INTERVAL,
	REDIS,
} from '../../lib/config.js';
import { redis, redisRO } from '../../infra/redis/index.js';
import { setTimeout } from 'timers/promises';

const { api } = sbvrUtils;

const getPollIntervalForDevice = _.once(() =>
	api.resin.prepare<{ deviceId: number }>({
		resource: 'device_config_variable',
		passthrough: { req: permissions.root },
		options: {
			$select: ['value'],
			$top: 1,
			$filter: {
				device: { '@': 'deviceId' },
				name: {
					$in: [
						'BALENA_SUPERVISOR_POLL_INTERVAL',
						'RESIN_SUPERVISOR_POLL_INTERVAL',
					],
				},
			},
			$orderby: {
				// we want the last value that would have been passed
				// to the supervisor, as that is the one it would have used.
				name: 'desc',
			},
		},
	}),
);

const getPollIntervalForParentApplication = _.once(() =>
	api.resin.prepare<{
		deviceId: number;
	}>({
		resource: 'application_config_variable',
		passthrough: { req: permissions.root },
		options: {
			$select: ['value'],
			$top: 1,
			$filter: {
				application: {
					$any: {
						$alias: 'a',
						$expr: {
							a: {
								owns__device: {
									$any: {
										$alias: 'd',
										$expr: {
											d: {
												id: { '@': 'deviceId' },
											},
										},
									},
								},
							},
						},
					},
				},
				name: {
					$in: [
						'BALENA_SUPERVISOR_POLL_INTERVAL',
						'RESIN_SUPERVISOR_POLL_INTERVAL',
					],
				},
			},
			$orderby: {
				// we want the last value that would have been passed
				// to the supervisor, as that is the one it would have used.
				name: 'desc',
			},
		},
	}),
);

export const getPollInterval = async (
	deviceId: number,
	config?: Dictionary<string>,
) => {
	let pollIntervalString: string | undefined;
	if (config != null) {
		// The order needs to be matching the above `$orderby: name: 'desc'`
		pollIntervalString =
			config['RESIN_SUPERVISOR_POLL_INTERVAL'] ??
			config['BALENA_SUPERVISOR_POLL_INTERVAL'];
	} else {
		pollIntervalString ??= (
			(await getPollIntervalForDevice()({
				deviceId,
			})) as Array<{
				value: string;
			}>
		)[0]?.value;

		pollIntervalString ??= (
			(await getPollIntervalForParentApplication()({
				deviceId,
			})) as Array<{ value: string }>
		)[0]?.value;
	}

	let pollInterval;
	if (pollIntervalString == null) {
		pollInterval = DEFAULT_SUPERVISOR_POLL_INTERVAL;
	} else {
		pollInterval = Math.max(
			parseInt(pollIntervalString, 10) || 0,
			DEFAULT_SUPERVISOR_POLL_INTERVAL,
		);
	}

	// adjust the value for the jitter in the Supervisor...
	return pollInterval * POLL_JITTER_FACTOR;
};

// the maximum time the supervisor will wait between polls...
export const POLL_JITTER_FACTOR = 1.5;

// these align to the text enums coming from the SBVR definition of available values...
export enum DeviceOnlineStates {
	Unknown = 'unknown',
	Timeout = 'timeout',
	Offline = 'offline',
	Online = 'online',
}

interface MetricEventArgs {
	startAt: number;
	endAt: number;
	err?: any;
}

interface DeviceOnlineStateManagerMessage {
	id: string;
	currentState: DeviceOnlineStates;
	/** The timestamp that the DB heartbeat was last updated */
	updatedAt?: number;
}

export class DeviceOnlineStateManager extends EventEmitter<{
	change: (
		args: MetricEventArgs & { deviceId: number; newState: DeviceOnlineStates },
	) => void;
	stats: (
		args: MetricEventArgs & {
			totalsent: number;
			totalrecv: number;
			msgs: number;
			hiddenmsgs: number;
		},
	) => void;
}> {
	private static readonly REDIS_NAMESPACE = 'device-online-state';
	private static readonly EXPIRED_QUEUE = 'expired';
	private static readonly RSMQ_READ_TIMEOUT = 30;
	private static readonly QUEUE_STATS_INTERVAL_MSEC = 10000;

	private readonly featureIsEnabled: boolean;

	private isConsuming: boolean = false;
	private rsmq: RedisSMQ;

	public constructor() {
		super();
		this.featureIsEnabled = API_HEARTBEAT_STATE_ENABLED === 1;

		// return early if the feature isn't active...
		if (!this.featureIsEnabled) {
			return;
		}

		this.rsmq = new RedisSMQ({
			// TODO: RSMQ does not currently support a redis cluster
			...REDIS.general.host,
			...REDIS.general.auth,
			ns: DeviceOnlineStateManager.REDIS_NAMESPACE,
		});

		// create the RedisMQ queue and start consuming messages...
		void this.rsmq
			.createQueueAsync({ qname: DeviceOnlineStateManager.EXPIRED_QUEUE })
			.catch((err) => {
				if (err.name !== 'queueExists') {
					throw err;
				}
			})
			.then(() =>
				this.setupQueueStatsEmitter(
					DeviceOnlineStateManager.QUEUE_STATS_INTERVAL_MSEC,
				),
			);
	}

	private setupQueueStatsEmitter(interval: number) {
		void setTimeout(interval, undefined, { ref: false }).then(async () => {
			try {
				const startAt = Date.now();
				const queueAttributes = await this.rsmq.getQueueAttributesAsync({
					qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
				});
				const endAt = Date.now();

				this.emit('stats', {
					startAt,
					endAt,
					totalsent: queueAttributes.totalsent,
					totalrecv: queueAttributes.totalrecv,
					msgs: queueAttributes.msgs,
					hiddenmsgs: queueAttributes.hiddenmsgs,
				});
			} catch (err) {
				captureException(
					err,
					'RSMQ: Unable to acquire and emit the queue stats.',
				);
			} finally {
				this.setupQueueStatsEmitter(interval);
			}
		});
	}

	private async updateDeviceModel(
		deviceId: number,
		newState: DeviceOnlineStates,
	): Promise<void> {
		const startAt = Date.now();
		let err;

		try {
			// patch the api_heartbeat_state value to the new state...
			const baseBody = {
				api_heartbeat_state: newState,
			};
			await api.resin.patch({
				resource: 'device',
				passthrough: { req: permissions.root },
				id: deviceId,
				options: {
					$filter: {
						$not: baseBody,
					},
				},
				body: {
					...baseBody,
					// Since the heartbeat manager is the only place that we update the heartbeat state
					// we are updating the heartbeat's change date in here rather than a hook, so that
					// we can avoid the extra DB request that a generic hook would require for checking
					// whether the value actually changed or not.
					last_changed_api_heartbeat_state_on__date: Date.now(),
				},
			});
		} catch ($err) {
			err = $err;
			captureException(
				$err,
				`DeviceStateManager: Error updating the API state of device ${deviceId} to ${newState}.`,
			);
			throw err;
		} finally {
			this.emit('change', {
				deviceId,
				newState,
				startAt,
				endAt: Date.now(),
				err,
			});
		}
	}

	private consume() {
		// pull a message from the queue...
		void this.rsmq
			.receiveMessageAsync({
				qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
				vt: DeviceOnlineStateManager.RSMQ_READ_TIMEOUT, // prevent other consumers seeing the same message (if any) preventing multiple API agents from processing it...
			})
			.then(async (msg) => {
				if (!('id' in msg)) {
					// no messages to consume, wait a second...
					return await setTimeout(1000);
				}

				const { id, message } = msg;
				try {
					const { deviceId, nextState } = JSON.parse(message) as {
						deviceId: number;
						nextState: DeviceOnlineStates;
					};

					// raise and event for the state change...
					switch (nextState) {
						case DeviceOnlineStates.Timeout:
							await this.updateDeviceModel(
								deviceId,
								DeviceOnlineStates.Timeout,
							);
							void this.scheduleChangeOfStateForDevice(
								deviceId,
								await this.getDeviceOnlineState(deviceId),
								DeviceOnlineStates.Timeout,
								DeviceOnlineStates.Offline,
								API_HEARTBEAT_STATE_TIMEOUT_SECONDS, // put the device into a timeout state if it misses it's scheduled heartbeat window... then mark as offline
							);
							break;
						case DeviceOnlineStates.Offline:
							await this.updateDeviceModel(
								deviceId,
								DeviceOnlineStates.Offline,
							);
							// This not only cleans-up the write cache for housekeeping reasons, but also
							// invalidates it whenever a device goes Offline.
							// This way, after an incident/downtime, when the RSMQ resumes processing the pending heartbeat changes
							// and new state GETs arrive, racing to update the DB & write cache's heartbeat state,
							// the DB & write cache get back in sync (if they have drifted) as soon as each device is marked as Offline,
							// allowing it to go back Online on the next state GET.
							await redis.del(
								`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${deviceId}`,
							);
							break;
						default:
							throw new Error(
								`An unexpected value was encountered for the target device state: ${nextState}`,
							);
					}

					await this.rsmq.deleteMessageAsync({
						qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
						id,
					});
				} catch (err) {
					captureException(
						err,
						'An error occurred trying to process an API heartbeat event.',
					);
				}
			})
			.catch((err: Error) =>
				captureException(
					err,
					'An error occurred while consuming API heartbeat state queue',
				),
			)
			.then(() => this.consume());

		return null;
	}

	private async getDeviceOnlineState(deviceId: number) {
		try {
			const value = await redisRO.get(
				`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${deviceId}`,
			);
			if (value == null) {
				return;
			}
			return JSON.parse(value) as DeviceOnlineStateManagerMessage;
		} catch {
			// Ignore
		}
	}

	private async scheduleChangeOfStateForDevice(
		deviceId: number,
		previousManagerState: DeviceOnlineStateManagerMessage | undefined,
		currentState: DeviceOnlineStates,
		nextState: DeviceOnlineStates,
		delay: number, // in seconds
		updatedAt?: number,
	) {
		if (previousManagerState?.id != null) {
			try {
				// remove the old queued state...
				await this.rsmq.deleteMessageAsync({
					qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
					id: previousManagerState.id,
				});
			} catch {
				// ignore errors when deleting the old queued state, it may have already expired...
			}
		}

		const newId = await this.rsmq.sendMessageAsync({
			qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
			message: JSON.stringify({
				deviceId,
				nextState,
			}),
			delay,
		});

		// if we didn't just update the heartbeat and are in still the same state,
		// then carry over the original change timestamp.
		if (
			API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT != null &&
			previousManagerState?.currentState === currentState
		) {
			updatedAt ??= previousManagerState.updatedAt;
		}

		await redis.set(
			`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${deviceId}`,
			JSON.stringify({
				id: newId,
				currentState,
				...(updatedAt != null && {
					updatedAt,
				}),
			} satisfies DeviceOnlineStateManagerMessage),
			'EX',
			delay + 5,
		);
	}

	public start() {
		if (this.isConsuming || !this.featureIsEnabled) {
			return;
		}

		this.isConsuming = true;
		this.consume();

		deviceStateEvents.on('get-state', async (deviceId, { apiKey, config }) => {
			try {
				const key = apiKey?.key;
				if (typeof key !== 'string') {
					return;
				}

				const isDeviceApiKey = await isApiKeyWithRole(key, 'device-api-key');
				if (!isDeviceApiKey) {
					return;
				}
				const pollInterval = await getPollInterval(deviceId, config);

				await this.captureEventFor(deviceId, pollInterval / 1000);
			} catch (err) {
				captureException(
					err,
					`Unable to capture the API heartbeat event for device: ${deviceId}`,
				);
			}
		});
	}

	public async captureEventFor(deviceId: number, timeoutSeconds: number) {
		if (!this.featureIsEnabled) {
			return;
		}

		let updatedAt: number | undefined;
		const previousDeviceOnlineState = await this.getDeviceOnlineState(deviceId);
		// If redis still has a valid message about the device being online we can avoid reaching to the DB...
		if (
			previousDeviceOnlineState == null ||
			previousDeviceOnlineState.currentState !== DeviceOnlineStates.Online ||
			(API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT != null &&
				(previousDeviceOnlineState.updatedAt == null ||
					Date.now() >
						previousDeviceOnlineState.updatedAt +
							API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT))
		) {
			// otherwise update the device model...
			await this.updateDeviceModel(deviceId, DeviceOnlineStates.Online);
			if (API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT != null) {
				updatedAt = Date.now();
			}
		}

		// record the activity...
		await this.scheduleChangeOfStateForDevice(
			deviceId,
			previousDeviceOnlineState,
			DeviceOnlineStates.Online,
			DeviceOnlineStates.Timeout,
			Math.ceil(timeoutSeconds), // always make this a whole number of seconds, and round up to make sure we dont expire too soon...
			updatedAt,
		);
	}
}

export const getInstance = _.once(() => new DeviceOnlineStateManager());
