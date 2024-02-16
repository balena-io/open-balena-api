// Augment express.js with balena-specific attributes via declaration merging.

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		type Creds = import('../infra/auth/jwt-passport.js').Creds;
		// For some reason TS doesn't like v so we had to use `import()`
		// import type { User as ApiUser } from '../src/infra/auth/jwt-passport';
		type ApiUser = import('../infra/auth/jwt-passport.js').TokenUserPayload;
		type ApiKey = import('@balena/pinejs').sbvrUtils.ApiKey;

		// Augment Express.User to include the props of our ApiUser.

		interface User extends ApiUser {
			twoFactorRequired: false | undefined;
		}

		interface Request {
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
}
