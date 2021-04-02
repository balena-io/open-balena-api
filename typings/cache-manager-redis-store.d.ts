declare module 'cache-manager-redis-store' {
	import type { Store } from 'cache-manager';

	export = {
		create(...args: any[]): Store;,
	};
}
