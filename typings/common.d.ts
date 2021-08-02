import type { dbModule, types } from '@balena/pinejs';

declare global {
	type AnyObject = types.AnyObject;
	type Resolvable<R> = types.Resolvable<R>;
	type Tx = dbModule.Tx;

	interface Dictionary<T> {
		[key: string]: T;
	}

	type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U;
	type Writable<T> = { -readonly [K in keyof T]: T[K] };
	type NonNullableField<T, F extends keyof T> = Overwrite<
		T,
		{
			[P in F]: NonNullable<T[P]>;
		}
	>;

	type ResolvableReturnType<T extends (...args: any[]) => any> = T extends (
		...args: any[]
	) => Resolvable<infer R>
		? R
		: any;
}
