// Augment express.js with balena-specific attributes via declaration merging.

// tslint:disable-next-line:no-namespace
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

		error?: any;
		subject?: string;
		custom?: AnyObject;

		resetRatelimit?: () => Promise<void>;
	}
}
