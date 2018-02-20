import * as Promise from 'bluebird';
import { EventEmitter } from 'events';
import * as _ from 'lodash';
import _PubNub = require('pubnub');
import {
	DeviceLog,
	DeviceLogsBackend,
	Subscription,
	LogContext,
	LogWriteContext,
} from '../struct';
import { PUBNUB_PUBLISH_KEY, PUBNUB_SUBSCRIBE_KEY } from '../../config';

interface Log {
	m: string; // Message
	t?: number | string; // Timestamp
	s?: number; // Is System (numerified boolean)
	c?: number; // Service ID
}

// Union of history and subscription structures
interface Item {
	timetoken: number | string;
	channel?: string;
	// One or the other
	message?: any;
	entry?: any;
}

// Default is 100 so send a big number to override but not too big that it could overload the API
const COUNT = 10000;

export class PubNubBackend implements DeviceLogsBackend {
	// Exposed publicly so the tests can override it
	public static enabled: boolean = !!(
		PUBNUB_PUBLISH_KEY && PUBNUB_SUBSCRIBE_KEY
	);
	private pubnub: _PubNub;
	private subscriptions: EventEmitter;

	constructor() {
		// Internally use an EventEmitter to track subscriptions
		this.subscriptions = new EventEmitter();
	}

	public history(ctx: LogContext): Promise<DeviceLog[]> {
		// Convert the Promise returned by the PubNub SDK to a Bluebird Promise
		return Promise.resolve(
			this.get().history({ channel: this.getChannel(ctx), count: COUNT }),
		).then(res => {
			return _.flatten(res.messages.map(this.fromPubNubLogs));
		});
	}

	public get available(): boolean {
		return PubNubBackend.enabled;
	}

	public publish(ctx: LogWriteContext, logs: DeviceLog[]): Promise<any> {
		const message = logs.map(this.toPubNubLog);
		// Convert the Promise returned by the PubNub SDK to a Bluebird Promise
		return Promise.resolve(
			this.get().publish({ channel: this.getChannel(ctx), message }),
		);
	}

	public subscribe(ctx: LogContext, subscription: Subscription) {
		const channel = this.getChannel(ctx);
		if (!this.subscriptions.listenerCount(channel)) {
			this.get().subscribe({ channels: [channel] });
		}
		this.subscriptions.on(channel, subscription);
	}

	public unsubscribe(ctx: LogContext, subscription: Subscription) {
		const channel = this.getChannel(ctx);
		this.subscriptions.removeListener(channel, subscription);
		if (!this.subscriptions.listenerCount(channel)) {
			this.get().unsubscribe({ channels: [channel] });
		}
	}

	private get() {
		// Module and instance are initialized only if and when needed
		if (!this.pubnub) {
			const PubNub: typeof _PubNub = require('pubnub');
			this.pubnub = new PubNub({
				publishKey: PUBNUB_PUBLISH_KEY,
				subscribeKey: PUBNUB_SUBSCRIBE_KEY,
				ssl: true,
			});
			// Preemptively set our global listener
			this.pubnub.addListener({ message: this.handleSubscription.bind(this) });
		}
		return this.pubnub;
	}

	private getChannel(ctx: LogContext) {
		// Use the logs channel and if missing, the uuid
		return `device-${ctx.logs_channel || ctx.uuid}-logs`;
	}

	private handleSubscription(item: Item) {
		for (const log of this.fromPubNubLogs(item)) {
			this.subscriptions.emit(item.channel!, log);
		}
	}

	private fromPubNubLogs(item: Item): DeviceLog[] {
		// The PubNub SDK uses "entry" for history and message for subscription
		const message: any = item.message || item.entry;
		// When missing, use the timetoken (it has 4 digits more than epochs)
		const timestamp: number = Math.floor(Number(item.timetoken) / 10000);
		// Coming from ancient supervisor
		if (typeof message === 'string') {
			return [
				{
					message,
					createdAt: timestamp,
					timestamp: timestamp,
					isSystem: /\[system\]/.test(message),
					isStdErr: false,
				},
			];
		}
		// Modern supervisor
		if (Array.isArray(message)) {
			return message.map(
				(log: Log): DeviceLog => {
					// log.t might be a timestamp, 8601 string, or undefined
					let parsedTime: number = timestamp;
					if (log.t != null) {
						if (_.isNumber(log.t)) {
							parsedTime = log.t;
						} else {
							parsedTime = Date.parse(log.t);
						}
					}

					return {
						message: log.m,
						createdAt: parsedTime,
						timestamp: parsedTime,
						isSystem: !!log.s,
						isStdErr: false,
						serviceId: log.c,
					};
				},
			);
		}

		if (!_.isObject(message)) {
			return [];
		}

		// Legacy supervisor
		return [
			{
				message: message.message || '',
				createdAt: message.timestamp || timestamp,
				timestamp: message.timestamp || timestamp,
				isSystem: !!message.isSystem,
				isStdErr: false,
				serviceId: message.serviceId,
			},
		];
	}

	private toPubNubLog(log: DeviceLog): Log {
		// Remove falsy values
		return _.pickBy({
			m: log.message,
			s: log.isSystem ? 1 : 0,
			t: log.timestamp,
			c: log.serviceId,
		}) as Log;
	}
}
