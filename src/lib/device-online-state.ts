import * as Bluebird from 'bluebird';
import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from './env-vars';
import { noop } from 'lodash';
import { resinApi, root } from '../platform';
import { captureException } from '../platform/errors';
import {
	createPromisifedRedisClient,
	PromisifedRedisClient,
} from './redis-promise';
import * as RedisSMQ from 'rsmq';
import {
	REDIS_HOST,
	REDIS_PORT,
	API_HEARTBEAT_STATE_ENABLED,
	API_HEARTBEAT_STATE_TIMEOUT_SECONDS,
} from './config';

const getPollIntervalForDevice = resinApi.prepare<{ uuid: string }>({
	resource: 'device_config_variable',
	passthrough: { req: root },
	options: {
		$select: ['name', 'value'],
		$top: 1,
		$expand: {
			device: {
				$filter: { uuid: { '@': 'uuid' } },
			},
		},
		$filter: {
			device: {
				uuid: { '@': 'uuid' },
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
});

const getPollIntervalForParentApplication = resinApi.prepare<{ uuid: string }>({
	resource: 'application_config_variable',
	passthrough: { req: root },
	options: {
		$select: ['name', 'value'],
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
											uuid: { '@': 'uuid' },
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
});

export const getPollInterval = (uuid: string): Bluebird<number> => {
	return getPollIntervalForDevice({ uuid })
		.then((pollIntervals: Array<{ value: string }>) => {
			if (pollIntervals.length >= 1) {
				return pollIntervals;
			}

			return getPollIntervalForParentApplication({ uuid });
		})
		.then((pollIntervals: Array<{ value: string }>) => {
			if (pollIntervals.length === 0) {
				return DEFAULT_SUPERVISOR_POLL_INTERVAL;
			}

			return Math.max(
				parseInt(pollIntervals[0].value, 10),
				DEFAULT_SUPERVISOR_POLL_INTERVAL,
			);
		});
};

// these align to the text enums coming from the SBVR definition of available values...
export const enum DeviceOnlineStates {
	Unknown = 'unknown',
	Timeout = 'timeout',
	Offline = 'offline',
	Online = 'online',
}

class DeviceOnlineStateManager {
	private static readonly REDIS_NAMESPACE = 'device-online-state';
	private static readonly EXPIRED_QUEUE = 'expired';
	private static readonly RSMQ_READ_TIMEOUT = 30;

	rsmq: RedisSMQ;
	redis: PromisifedRedisClient;

	constructor() {
		// return early if the feature isn't active...
		if (API_HEARTBEAT_STATE_ENABLED !== 1) {
			return;
		}

		// create a new Redis client...
		this.redis = createPromisifedRedisClient({
			host: REDIS_HOST,
			port: REDIS_PORT,
		});

		// initialise the RedisSMQ object using our Redis client...
		this.rsmq = new RedisSMQ({
			client: this.redis,
			ns: DeviceOnlineStateManager.REDIS_NAMESPACE,
		});

		// create the RedisMQ queue and start consuming messages...
		this.rsmq
			.createQueueAsync({ qname: DeviceOnlineStateManager.EXPIRED_QUEUE })
			.catch(err => {
				if (err.name !== 'queueExists') {
					throw err;
				}
			})
			.then(() => {
				return this.consume();
			});
	}

	private updateDeviceModel(uuid: string, newState: DeviceOnlineStates) {
		// patch the api_heartbeat_state value to the new state...
		const body = {
			api_heartbeat_state: newState,
		};

		return resinApi
			.patch({
				resource: 'device',
				options: {
					$filter: {
						uuid,
						$not: body,
					},
				},
				body,
				passthrough: {
					req: root,
				},
			})
			.return(true)
			.catch(err => {
				captureException(
					err,
					'DeviceStateManager: Error updating the API with the device new state.',
				);

				return false;
			});
	}

	// event emitters
	private deviceOnline(uuid: string) {
		return this.updateDeviceModel(uuid, DeviceOnlineStates.Online);
	}

	private consume() {
		// pull a message from the queue...
		this.rsmq
			.receiveMessageAsync({
				qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
				vt: DeviceOnlineStateManager.RSMQ_READ_TIMEOUT, // prevent other consumers seeing the same message (if any) preventing multiple API agents from processing it...
			})
			.then(msg => {
				if ('id' in msg) {
					const { id, message } = msg;

					return Bluebird.try(() => {
						const { uuid, nextState } = JSON.parse(message) as {
							uuid: string;
							nextState: DeviceOnlineStates;
						};

						// raise and event for the state change...
						switch (nextState) {
							case DeviceOnlineStates.Timeout:
								this.scheduleChangeOfStateForDevice(
									uuid,
									DeviceOnlineStates.Timeout,
									DeviceOnlineStates.Offline,
									API_HEARTBEAT_STATE_TIMEOUT_SECONDS, // put the device into a timeout state if it misses it's scheduled heartbeat window... then mark as offline
								);
								return this.updateDeviceModel(uuid, DeviceOnlineStates.Timeout);
							case DeviceOnlineStates.Offline:
								return this.updateDeviceModel(uuid, DeviceOnlineStates.Offline);
							default:
								throw new Error(
									`An unexpected value was encountered for the target device state: ${nextState}`,
								);
						}
					})
						.then(() =>
							this.rsmq.deleteMessageAsync({
								qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
								id,
							}),
						)
						.catch((err: Error) =>
							captureException(
								err,
								'An error occurred trying to process an API heartbeat event.',
							),
						);
				} else {
					// no messages to consume, wait a second...
					return Bluebird.delay(1000);
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

	private scheduleChangeOfStateForDevice(
		uuid: string,
		currentState: DeviceOnlineStates,
		nextState: DeviceOnlineStates,
		delay: number, // in seconds
	) {
		// remove the old queued state...
		return this.redis
			.getAsync(`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${uuid}`)
			.then(value => {
				if (value == null) {
					return;
				}

				const { id } = JSON.parse(value) as { id: string };

				if (id) {
					return this.rsmq
						.deleteMessageAsync({
							qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
							id,
						})
						.catch(noop); // ignore errors when deleting the old queued state, it may have already expired...
				}
			})
			.then(() =>
				this.rsmq.sendMessageAsync({
					qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
					message: JSON.stringify({
						uuid,
						nextState,
					}),
					delay,
				}),
			)
			.then(id =>
				this.redis.setAsync(
					`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${uuid}`,
					JSON.stringify({
						id,
						currentState,
					}),
					'EX',
					delay + 5,
				),
			);
	}

	public captureEventFor(uuid: string, timeoutSeconds: number) {
		if (API_HEARTBEAT_STATE_ENABLED !== 1) {
			return Promise.resolve();
		}

		// see if we already have a queued state for this device...
		return (
			this.redis
				.getAsync(`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${uuid}`)
				.then(value => {
					if (value == null) {
						return true;
					}

					const { id, currentState } = JSON.parse(value);

					if (!id || currentState !== DeviceOnlineStates.Online) {
						return true;
					}

					return false;
				})
				.catch(() => {
					// no queued state was found, so it must have just come online...
					return true;
				})
				.then(setDeviceOnline => {
					if (setDeviceOnline) {
						return this.deviceOnline(uuid).return();
					}
				})
				// record the activity...
				.then(() => {
					return this.scheduleChangeOfStateForDevice(
						uuid,
						DeviceOnlineStates.Online,
						DeviceOnlineStates.Timeout,
						timeoutSeconds,
					);
				})
		);
	}
}

export const manager = new DeviceOnlineStateManager();
