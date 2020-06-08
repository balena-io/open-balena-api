import { sbvrUtils } from '@resin/pinejs';
import { Resolvable } from '@resin/pinejs/out/sbvr-api/common-types';

declare global {
	type AnyObject = sbvrUtils.AnyObject;

	interface Dictionary<T> {
		[key: string]: T;
	}

	type Writable<T> = { -readonly [K in keyof T]: T[K] };

	type ResolvableReturnType<T extends (...args: any[]) => any> = T extends (
		...args: any[]
	) => Resolvable<infer R>
		? R
		: any;
}
