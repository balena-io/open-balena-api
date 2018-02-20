declare module 'pubnub' {
	type PubNubOptions = {
		publishKey?: string;
		subscribeKey?: string;
		secretKey?: string;
		ssl?: boolean;
	};

	type SubscribeOptions = {
		channels: string[];
	};

	type Message = {
		channel: string;
		message: any;
		timetoken: number | string;
	};

	type ListenerOptions = {
		message: (message: Message) => void;
	};

	type HistoryOptions = {
		channel: string;
		start?: string;
		end?: string;
		reverse?: boolean; // default false
		count?: number; // default 100
	};

	type HistoryResponse = {
		startTimeToken: string;
		endTimeToken: string;
		messages: Array<{
			entry: any;
			timetoken: number | string;
		}>;
	};

	type PublishOptions = {
		message: any;
		channel: string;
		storeInHistory?: boolean; // default true
		ttl?: number;
	};

	class PubNub {
		constructor(opts: PubNubOptions);
		subscribe(opts: SubscribeOptions): void;
		unsubscribe(opts: SubscribeOptions): void;
		unsubscribeAll(): void;
		addListener(opts: ListenerOptions): void;
		removeListener(opts: ListenerOptions): void;
		publish(opts: PublishOptions): Promise<any>;
		history(opts: HistoryOptions): Promise<HistoryResponse>;
	}

	export = PubNub;
}
