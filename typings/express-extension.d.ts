// Augment express.js with balena-specific attributes via declaration merging.

// tslint:disable-next-line:no-namespace
declare namespace Express {
	type ApiUser = import('../src/infra/auth/jwt-passport').User;

	// tslint:disable-next-line:no-empty-interface
	interface User extends ApiUser {}
	export interface Request {
		prefetchApiKey?: Resolvable<ApiKey>;

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

		skipLogging?: true;
	}
}
