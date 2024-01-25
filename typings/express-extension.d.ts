// Augment express.js with balena-specific attributes via declaration merging.
declare namespace Express {
	type Creds = import('../src/infra/auth/jwt-passport').Creds;
	// For some reason TS doesn't like v so we had to use `import()`
	// import type { User as ApiUser } from '../src/infra/auth/jwt-passport';
	type ApiUser = import('../src/infra/auth/jwt-passport').TokenUserPayload;
	type ApiKey = import('@balena/pinejs').sbvrUtils.ApiKey;

	// Augment Express.User to include the props of our ApiUser.

	interface User extends ApiUser {
		twoFactorRequired: false | undefined;
	}

	export interface Request {
		prefetchApiKey?: Resolvable<ApiKey | undefined>;

		creds?: Creds;

		partialUser: ApiUser & {
			twoFactorRequired: true;
		};

		custom?: AnyObject;

		resetRatelimit?: () => Promise<void>;

		skipLogging?: true;
	}
}
