import { JwtFromRequestFunction } from 'passport-jwt';

declare module 'passport-jwt' {
	export declare namespace ExtractJwt {
		export function versionOneCompatibility(opts: {
			tokenBodyField: string;
			authScheme: string;
		}): JwtFromRequestFunction;
	}
}
