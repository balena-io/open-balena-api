import type { JwtFromRequestFunction } from 'passport-jwt';

declare module 'passport-jwt' {
	export namespace ExtractJwt {
		export function versionOneCompatibility(opts: {
			tokenBodyField: string;
			authScheme: string;
		}): JwtFromRequestFunction;
	}
}
