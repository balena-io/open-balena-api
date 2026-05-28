// Augment express.js with balena-specific attributes via declaration merging.

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		type Creds = import('../infra/auth/jwt-passport.js').Creds;
		// For some reason TS doesn't like v so we had to use `import()`
		type ResolvedUserPayload =
			import('../infra/auth/jwt-passport.js').ResolvedUserPayload;
		type ScopedToken = import('../infra/auth/jwt.js').ScopedToken;
		type ApiKey = import('@balena/pinejs').sbvrUtils.ApiKey;

		// `req.user` can be either a full user payload or a scoped token —
		// both share the `ScopedToken` shape (actor + permissions); user-specific
		// fields like `id` only exist on the full user variant.
		interface User extends ScopedToken, Partial<ResolvedUserPayload> {
			twoFactorRequired?: false | undefined;
		}

		interface Request {
			prefetchApiKey?: Resolvable<ApiKey | undefined>;

			creds?: Creds;

			partialUser: ResolvedUserPayload & {
				twoFactorRequired: true;
			};

			custom?: AnyObject;

			resetRatelimit?: () => Promise<void>;

			skipLogging?: true;
		}
	}
}
