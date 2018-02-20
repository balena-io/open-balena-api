import * as ExpressBrute from 'express-brute';
import * as Express from 'express';

declare module 'express-brute' {
	interface FailTooManyRequests {
		(
			req: Express.Request,
			res: Express.Response,
			next: Express.NextFunction,
			nextValidRequestDate: Date,
		): void;
	}
	export function FailTooManyRequests(
		req: Express.Request,
		res: Express.Response,
		next: Express.NextFunction,
		nextValidRequestDate: Date,
	): void;
}
