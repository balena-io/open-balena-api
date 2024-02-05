import './thirty-two-shim.js';

declare module 'thirty-two' {
	export const encode: (key: string | Buffer) => string;
}
