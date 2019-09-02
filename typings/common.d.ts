import { sbvrUtils } from '@resin/pinejs';

declare global {
	type AnyObject = sbvrUtils.AnyObject;

	interface Dictionary<T> {
		[key: string]: T;
	}

	type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U;
}
