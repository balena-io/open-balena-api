import type { dbModule, types } from '@resin/pinejs';

declare global {
	type AnyObject = types.AnyObject;
	type Resolvable<R> = types.Resolvable<R>;
	type Tx = dbModule.Tx;

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
