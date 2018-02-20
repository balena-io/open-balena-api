declare module 'resin-device-config' {
	export interface GenerateOptions {
		application: {
			app_name: string;
			id: number;
			deviceType?: string;
		};
		deviceType?: string;
		user: {
			id: number;
			username: string;
		};
		vpnPort?: string;

		endpoints: {
			api: string;
			delta: string;
			registry: string;
			vpn: string;
		};

		pubnub: {
			subscribe_key?: string;
			publish_key?: string;
		};
		mixpanel: {
			token?: string;
		};
		apiKey?: string;
		version?: string;
	}

	export interface GenerateParams {
		appUpdatePollInterval?: number;
		network?: Array<>;
		ip?: string;
		gateway?: string;
		netmask?: string;
		wifiSsid?: string;
		wifiKey?: string;
		connectivity?: string;
		network?:
			| wifi
			| Array<{
					wifiSsid?: string;
					wifiKey?: string;
					configuration?: string;
			  }>;
	}

	export function generate(
		options: GenerateOptions,
		params: GenerateParams,
	): AnyObject;
}
