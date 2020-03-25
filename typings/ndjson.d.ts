declare module 'ndjson' {
	import type { Transform } from 'stream';

	interface Opts {
		strict: boolean = true;
	}

	export function parse(opts?: Opts): Transform;
	export function serialize(opts?: Opts): Transform;
	export function stringify(opts?: Opts): Transform;
}
