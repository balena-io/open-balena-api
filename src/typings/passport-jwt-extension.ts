declare module 'passport-jwt' {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace ExtractJwt {
		export function versionOneCompatibility(opts: {
			tokenBodyField: string;
			authScheme: string;
		}): JwtFromRequestFunction;
	}
}
