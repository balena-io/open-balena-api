import * as Bluebird from 'bluebird';
import * as events from 'eventemitter3';
import * as _ from 'lodash';
import * as RedisSMQ from 'rsmq';

import { sbvrUtils } from '@resin/pinejs';

import { captureException } from '../platform/errors';

import {
	API_HEARTBEAT_STATE_ENABLED,
	API_HEARTBEAT_STATE_TIMEOUT_SECONDS,
	DEFAULT_SUPERVISOR_POLL_INTERVAL,
	REDIS_HOST,
	REDIS_PORT,
} from './config';
import {
	createPromisifedRedisClient,
	PromisifedRedisClient,
} from './redis-promise';

const { root, api } = sbvrUtils;

export const getPollInterval = async (uuid: string) => {
	const getPollIntervalForDevice = api.resin.prepare<{ uuid: string }>({
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

	const getPollIntervalForParentApplication = api.resin.prepare<{
		uuid: string;
	}>({
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

	let pollIntervals = (await getPollIntervalForDevice({ uuid })) as Array<{
		value: string;
	}>;

	if (pollIntervals.length === 0) {
		pollIntervals = (await getPollIntervalForParentApplication({
			uuid,
		})) as Array<{ value: string }>;
	}

	let pollInterval;
	if (pollIntervals.length === 0) {
		pollInterval = DEFAULT_SUPERVISOR_POLL_INTERVAL;
	} else {
		pollInterval = Math.max(
			parseInt(pollIntervals[0].value, 10) || 0,
			DEFAULT_SUPERVISOR_POLL_INTERVAL,
		);
	}

	// adjust the value for the jitter in the Supervisor...
	return pollInterval * POLL_JITTER_FACTOR;
};

// the maximum time the supervisor will wait between polls...
export const POLL_JITTER_FACTOR = 1.5;

// these align to the text enums coming from the SBVR definition of available values...
export const enum DeviceOnlineStates {
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

export declare interface DeviceOnlineStateManager {
	emit(
		event: 'change',
		args: MetricEventArgs & { uuid: string; newState: DeviceOnlineStates },
	): boolean;
	emit(
		event: 'stats',
		args: MetricEventArgs & {
			totalsent: number;
			totalrecv: number;
			msgs: number;
			hiddenmsgs: number;
		},
	): boolean;

	on(
		event: 'change',
		listener: (
			args: MetricEventArgs & { uuid: string; newState: DeviceOnlineStates },
		) => void,
	): this;
	on(
		event: 'stats',
		listener: (
			args: MetricEventArgs & {
				totalsent: number;
				totalrecv: number;
				msgs: number;
				hiddenmsgs: number;
			},
		) => void,
	): this;
	on(event: string, listener: (args: AnyObject) => void): this;
}

export class DeviceOnlineStateManager extends events.EventEmitter {
	private static readonly REDIS_NAMESPACE = 'device-online-state';
	private static readonly EXPIRED_QUEUE = 'expired';
	private static readonly RSMQ_READ_TIMEOUT = 30;
	private static readonly QUEUE_STATS_INTERVAL_MSEC = 10000;

	private readonly featureIsEnabled: boolean;

	private isConsuming: boolean = false;
	private rsmq: RedisSMQ;
	private redis: PromisifedRedisClient;

	public constructor() {
		super();
		this.featureIsEnabled = API_HEARTBEAT_STATE_ENABLED === 1;

		// return early if the feature isn't active...
		if (!this.featureIsEnabled) {
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

	private async setupQueueStatsEmitter(interval: number) {
		return setTimeout(async () => {
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
		}, interval).unref();
	}

	private async updateDeviceModel(
		uuid: string,
		newState: DeviceOnlineStates,
	): Promise<boolean> {
		// patch the api_heartbeat_state value to the new state...
		const body = {
			api_heartbeat_state: newState,
		};

		const eventArgs = {
			uuid,
			newState,
			startAt: Date.now(),
			endAt: Date.now(),
			err: undefined,
		};

		try {
			await api.resin.patch({
				resource: 'device',
				passthrough: { req: root },
				options: {
					$filter: {
						uuid,
						$not: body,
					},
				},
				body,
			});
		} catch (err) {
			eventArgs.err = err;
			captureException(
				err,
				'DeviceStateManager: Error updating the API with the device new state.',
			);
		} finally {
			eventArgs.endAt = Date.now();
			this.emit('change', eventArgs);
		}
		return eventArgs.err !== undefined;
	}

	private consume() {
		// pull a message from the queue...
		this.rsmq
			.receiveMessageAsync({
				qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
				vt: DeviceOnlineStateManager.RSMQ_READ_TIMEOUT, // prevent other consumers seeing the same message (if any) preventing multiple API agents from processing it...
			})
			.then(async (msg) => {
				if (!('id' in msg)) {
					// no messages to consume, wait a second...
					return Bluebird.delay(1000);
				}

				const { id, message } = msg;
				try {
					const { uuid, nextState } = JSON.parse(message) as {
						uuid: string;
						nextState: DeviceOnlineStates;
					};

					// raise and event for the state change...
					switch (nextState) {
						case DeviceOnlineStates.Timeout:
							await Promise.all([
								this.scheduleChangeOfStateForDevice(
									uuid,
									DeviceOnlineStates.Timeout,
									DeviceOnlineStates.Offline,
									API_HEARTBEAT_STATE_TIMEOUT_SECONDS, // put the device into a timeout state if it misses it's scheduled heartbeat window... then mark as offline
								),
								this.updateDeviceModel(uuid, DeviceOnlineStates.Timeout),
							]);
							break;
						case DeviceOnlineStates.Offline:
							await this.updateDeviceModel(uuid, DeviceOnlineStates.Offline);
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

	private async scheduleChangeOfStateForDevice(
		uuid: string,
		currentState: DeviceOnlineStates,
		nextState: DeviceOnlineStates,
		delay: number, // in seconds
	) {
		// remove the old queued state...
		const value = await this.redis.getAsync(
			`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${uuid}`,
		);

		if (value != null) {
			const { id } = JSON.parse(value) as { id: string };

			if (id) {
				try {
					await this.rsmq.deleteMessageAsync({
						qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
						id,
					});
				} catch {
					// ignore errors when deleting the old queued state, it may have already expired...
				}
			}
		}

		const newId = await this.rsmq.sendMessageAsync({
			qname: DeviceOnlineStateManager.EXPIRED_QUEUE,
			message: JSON.stringify({
				uuid,
				nextState,
			}),
			delay,
		});

		return this.redis.setAsync(
			`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${uuid}`,
			JSON.stringify({
				id: newId,
				currentState,
			}),
			'EX',
			delay + 5,
		);
	}

	public start() {
		if (this.isConsuming || !this.featureIsEnabled) {
			return;
		}

		this.isConsuming = true;
		return this.consume();
	}

	public async captureEventFor(uuid: string, timeoutSeconds: number) {
		if (!this.featureIsEnabled) {
			return;
		}

		let setDeviceOnline = true;
		try {
			// see if we already have a queued state for this device...
			const value = await this.redis.getAsync(
				`${DeviceOnlineStateManager.REDIS_NAMESPACE}:${uuid}`,
			);

			if (value != null) {
				const { id, currentState } = JSON.parse(value);

				if (id && currentState === DeviceOnlineStates.Online) {
					setDeviceOnline = false;
				}
			}
		} catch {
			// no queued state was found, so it must have just come online...
		}

		if (setDeviceOnline) {
			await this.updateDeviceModel(uuid, DeviceOnlineStates.Online);
		}
		// record the activity...
		await this.scheduleChangeOfStateForDevice(
			uuid,
			DeviceOnlineStates.Online,
			DeviceOnlineStates.Timeout,
			Math.ceil(timeoutSeconds), // always make this a whole number of seconds, and round up to make sure we dont expire too soon...
		);
	}
}

export const getInstance = _.once(() => new DeviceOnlineStateManager());
