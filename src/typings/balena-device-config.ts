import './balena-device-config-shim.js';

declare module 'balena-device-config' {
	export interface GenerateOptions {
		application: {
			id: number;
			deviceType?: string;
		};
		deviceType?: string;
		user?: {
			id?: number;
		};
		vpnPort?: string;

		endpoints: {
			api: string;
			delta: string;
			registry: string;
			vpn?: string;
			logs?: string;
		};

		mixpanel?: {
			token?: string;
		};
		apiKey?: string;
		version?: string;
	}

	export interface GenerateParams {
		appUpdatePollInterval?: number;
		ip?: string;
		gateway?: string;
		netmask?: string;
		wifiSsid?: string;
		wifiKey?: string;
		connectivity?: string;
		network?:
			| 'wifi'
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
