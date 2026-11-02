import { stripIndent } from 'common-tags';
import { EventEmitter } from 'eventemitter3';
import _ from 'lodash';
import type { CommandParser, RedisArgument } from 'redis';
import { defineScript } from 'redis';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { captureException } from '../../infra/error-handling/index.ts';
import { isApiKeyWithRole } from '../api-keys/lib.ts';

import { events as deviceStateEvents } from '../device-state/index.ts';

import {
	API_HEARTBEAT_STATE_ENABLED,
	API_HEARTBEAT_STATE_TIMEOUT_SECONDS,
	API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT,
	DEFAULT_SUPERVISOR_POLL_INTERVAL,
} from '../../lib/config.ts';
import {
	createIsolatedRedis,
	redis,
	redisRO,
} from '../../infra/redis/index.ts';
import { setTimeout } from 'timers/promises';

const { api } = sbvrUtils;

const scripts = {
	claimDueMember: defineScript({
		SCRIPT: stripIndent`
		-- Take the earliest member that is due
		local due = redis.call("zrange", KEYS[1], "-inf", ARGV[1], "BYSCORE", "LIMIT", 0, 1)
		if #due == 0 then
			return false
		end
		-- And hide it from other consumers until the claim expires, at which point it is due again
		redis.call("zadd", KEYS[1], ARGV[2], due[1])
		return due[1]`,
		NUMBER_OF_KEYS: 1,
		parseCommand(
			parser: CommandParser,
			key: RedisArgument,
			now: number,
			claimedUntil: number,
		) {
			parser.pushKey(key);
			parser.push(`${now}`, `${claimedUntil}`);
		},
		transformReply: undefined as unknown as () => string | null,
	}),
	removeClaimedMember: defineScript({
		SCRIPT: stripIndent`
		-- Only remove the member if it has not been rescheduled since we claimed it
		if tonumber(redis.call("zscore", KEYS[1], ARGV[1])) == tonumber(ARGV[2]) then
			return redis.call("zrem", KEYS[1], ARGV[1])
		end
		return 0`,
		NUMBER_OF_KEYS: 1,
		parseCommand(
			parser: CommandParser,
			key: RedisArgument,
			member: RedisArgument,
			claimedUntil: number,
		) {
			parser.pushKey(key);
			parser.push(member, `${claimedUntil}`);
		},
		transformReply: undefined as unknown as () => number,
	}),
};

const redisWithScripts = await createIsolatedRedis({ scripts });

const getPollIntervalForDevice = _.once(() =>
	api.resin.prepare(
		{
			resource: 'device_config_variable',
			passthrough: { req: permissions.rootRead },
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
		} as const,
		{ deviceId: ['number'] },
	),
);

const getPollIntervalForParentApplication = _.once(() =>
	api.resin.prepare(
		{
			resource: 'application_config_variable',
			passthrough: { req: permissions.rootRead },
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
		} as const,
		{
			deviceId: ['number'],
		},
	),
);

export const getPollInterval = async (
	deviceId: number,
	config?: Record<string, string>,
) => {
	let pollIntervalString: string | undefined;
	if (config != null) {
		// The order needs to be matching the above `$orderby: name: 'desc'`
		pollIntervalString =
			config['RESIN_SUPERVISOR_POLL_INTERVAL'] ??
			config['BALENA_SUPERVISOR_POLL_INTERVAL'];
	} else {
		pollIntervalString ??= (
			await getPollIntervalForDevice()({
				deviceId,
			})
		)[0]?.value;

		pollIntervalString ??= (
			await getPollIntervalForParentApplication()({
				deviceId,
			})
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
export const DeviceOnlineStates = {
	Unknown: 'unknown',
	Timeout: 'timeout',
	Offline: 'offline',
	Online: 'online',
} as const;
export type DeviceOnlineStates =
	(typeof DeviceOnlineStates)[keyof typeof DeviceOnlineStates];

interface MetricEventArgs {
	startAt: number;
	endAt: number;
	err?: any;
}

interface DeviceOnlineStateManagerMessage {
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
			/** The number of scheduled state changes */
			msgs: number;
			/** The number of scheduled state changes that are either not due yet or currently being processed */
			hiddenmsgs: number;
		},
	) => void;
}> {
	private static readonly REDIS_NAMESPACE = 'device-online-state';
	/**
	 * A sorted set of the scheduled state changes, with `${deviceId}:${nextState}` members scored by the
	 * timestamp they are due at, so that rescheduling a device's change replaces it rather than adding another
	 */
	private static readonly SCHEDULED_QUEUE = `${DeviceOnlineStateManager.REDIS_NAMESPACE}:scheduled`;
	private static readonly CLAIM_TIMEOUT_MSEC = 30000;
	private static readonly QUEUE_STATS_INTERVAL_MSEC = 10000;
	/** The states that are scheduled as a device's next state, used to replace any change already scheduled for it */
	private static readonly SCHEDULED_STATES = [
		DeviceOnlineStates.Timeout,
		DeviceOnlineStates.Offline,
	] as const;

	private readonly featureIsEnabled: boolean;

	private isConsuming = false;

	public constructor() {
		super();
		this.featureIsEnabled = API_HEARTBEAT_STATE_ENABLED === 1;

		// return early if the feature isn't active...
		if (!this.featureIsEnabled) {
			return;
		}

		this.setupQueueStatsEmitter(
			DeviceOnlineStateManager.QUEUE_STATS_INTERVAL_MSEC,
		);
	}

	private setupQueueStatsEmitter(interval: number) {
		void setTimeout(interval, undefined, { ref: false }).then(async () => {
			try {
				const startAt = Date.now();
				const [msgs, hiddenmsgs] = await Promise.all([
					redisRO.zCard(DeviceOnlineStateManager.SCHEDULED_QUEUE),
					redisRO.zCount(
						DeviceOnlineStateManager.SCHEDULED_QUEUE,
						startAt,
						'+inf',
					),
				]);
				const endAt = Date.now();

				this.emit('stats', {
					startAt,
					endAt,
					msgs,
					hiddenmsgs,
				});
			} catch (err) {
				captureException(
					err,
					'DeviceStateManager: Unable to acquire and emit the queue stats.',
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
					changed_api_heartbeat_state_on__date: Date.now(),
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

	/**
	 * Claims the next due state change, hiding it from other consumers for CLAIM_TIMEOUT_MSEC
	 * so that multiple API agents do not process it, after which it will be consumed again unless removed
	 */
	private async claimNextChange(): Promise<
		| {
				deviceId: number;
				nextState: DeviceOnlineStates;
				remove: () => Promise<unknown>;
		  }
		| undefined
	> {
		const now = Date.now();
		const claimedUntil = now + DeviceOnlineStateManager.CLAIM_TIMEOUT_MSEC;

		const member = await redisWithScripts.claimDueMember(
			DeviceOnlineStateManager.SCHEDULED_QUEUE,
			now,
			claimedUntil,
		);
		if (member == null) {
			return;
		}
		const [deviceId, nextState] = member.split(':');
		return {
			deviceId: parseInt(deviceId, 10),
			nextState: nextState as DeviceOnlineStates,
			remove: () =>
				redisWithScripts.removeClaimedMember(
					DeviceOnlineStateManager.SCHEDULED_QUEUE,
					member,
					claimedUntil,
				),
		};
	}

	private consume() {
		// pull a state change from the queue...
		void this.claimNextChange()
			.then(async (change) => {
				if (change == null) {
					// no state changes to consume, wait a second...
					await setTimeout(1000);
					return;
				}

				try {
					const { deviceId, nextState } = change;

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
							// This way, after an incident/downtime, when the queue resumes processing the pending heartbeat changes
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

					await change.remove();
				} catch (err) {
					captureException(
						err,
						'An error occurred trying to process an API heartbeat event.',
					);
				}
			})
			.catch((err: Error) => {
				captureException(
					err,
					'An error occurred while consuming API heartbeat state queue',
				);
			})
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
		// schedule the next state, replacing any state change already scheduled for the device...
		await redis
			.multi()
			.zAdd(DeviceOnlineStateManager.SCHEDULED_QUEUE, {
				score: Date.now() + delay * 1000,
				value: `${deviceId}:${nextState}`,
			})
			.zRem(
				DeviceOnlineStateManager.SCHEDULED_QUEUE,
				DeviceOnlineStateManager.SCHEDULED_STATES.filter(
					(state) => state !== nextState,
				).map((state) => `${deviceId}:${state}`),
			)
			.exec();

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
				currentState,
				...(updatedAt != null && {
					updatedAt,
				}),
			} satisfies DeviceOnlineStateManagerMessage),
			{ expiration: { type: 'EX', value: delay + 5 } },
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
			previousDeviceOnlineState?.currentState !== DeviceOnlineStates.Online ||
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
