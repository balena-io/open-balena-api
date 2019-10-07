// Augment express.js with resin-specific attributes via declaration merging.

declare interface BruteReset {
	reset(cb?: (err?: Error) => void): void;
}

declare namespace Express {
	export interface Request {
		prefetchApiKey?: ApiKey;
		apiKey?: ApiKey;

		creds?: Creds;

		user?: User & {
			twoFactorRequired: false;
		};

		partialUser: User & {
			twoFactorRequired: true;
		};

		untranslatedUrl?: string;

		brute?: BruteReset;

		error?: any;
		subject?: string;
		custom?: AnyObject;
	}
}
