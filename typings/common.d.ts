import { sbvrUtils } from '@resin/pinejs';
import { Response } from 'request';
import { ScopedAccessToken } from '../src/platform/jwt';
import * as Bluebird from 'bluebird';

declare global {
	type AnyObject = sbvrUtils.AnyObject;

	interface Dictionary<T> {
		[key: string]: T;
	}

	type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U;

	// This gives the resolved return type, eg
	// - `Promise<R>` -> `R`
	// - `Bluebird<R>` -> `R`
	// - `R` -> `R`
	type ResolvableReturnType<T extends (...args: any[]) => any> = T extends (
		...args: any[]
	) => Promise<infer R>
		? R
		: T extends (...args: any[]) => Bluebird<infer R> ? R : ReturnType<T>;

	interface ApiKey extends sbvrUtils.ApiKey {
		key: string;
	}

	interface ServiceToken extends sbvrUtils.Actor {
		service: string;
		apikey: string;
		permissions: string[];
	}

	interface User extends sbvrUtils.User {
		id: number;
		username: string;
		email: string;
		created_at: string;
		permissions: string[];
		jwt_secret?: string;
		twoFactorRequired?: boolean;
		authTime: number;
		actor: number;
	}

	interface ScopedToken extends sbvrUtils.Actor {
		actor: number;
		permissions: string[];
	}

	type Creds = ServiceToken | User | ScopedToken;
	type JwtUser = Creds | ScopedAccessToken;

	// TODO: This should be exported by `lib/request` once it
	// and its dependencies are converted to proper modules
	type RequestResponse = [Response, any];
}
