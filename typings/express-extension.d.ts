// Augment express.js with resin-specific attributes via declaration merging.

declare interface BruteReset {
	reset(cb?: (err?: Error) => void): void;
}

declare namespace Express {
	export interface Request {
		user?: User & {
			twoFactorRequired: false;
		}; // see ./common.d.ts
		apiKey?: ApiKey; // see ./common.d.ts

		partialUser: User & {
			twoFactorRequired: true;
		};
		creds?: Creds;
		originalUrl?: string;
		untranslatedUrl?: string;
		brute?: BruteReset;

		error?: any;
		subject?: string;
		custom?: AnyObject;
	}
}
