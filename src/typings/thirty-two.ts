import './thirty-two-shim';

declare module 'thirty-two' {
	export const encode: (key: string | Buffer) => string;
}
