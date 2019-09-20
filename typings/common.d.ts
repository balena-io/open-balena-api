import { sbvrUtils } from '@resin/pinejs';

declare global {
	type AnyObject = sbvrUtils.AnyObject;

	interface Dictionary<T> {
		[key: string]: T;
	}

	type Writable<T> = { -readonly [K in keyof T]: T[K] };
}
