// Augment express.js with balena-specific attributes via declaration merging.
declare namespace Express {
	type ApiUser = import('../src/infra/auth/jwt-passport').User;

	// Augment Express.User to include the props of our ApiUser.
	// eslint-disable-next-line @typescript-eslint/no-empty-interface
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
