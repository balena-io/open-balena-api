export * from './resources';
export * from './utils';

export interface Composition {
	version: string;
	networks?: AnyObject;
	volumes: Dictionary<AnyObject | null>;
	services: Dictionary<
		Partial<{
			build: Dictionary<string>;
			privileged: boolean;
			restart: string;
			network_mode: string;
			volumes: string[];
			labels: Dictionary<string>;
		}>
	>;
}
