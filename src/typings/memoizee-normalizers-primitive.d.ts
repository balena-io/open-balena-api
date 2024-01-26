// Unfortunately this declaration cannot follow the normal pattern of unchecked shim + checked augmentation because of the `export =` requirement
declare module 'memoizee/normalizers/primitive' {
	function PrimitiveNormalizer(args: any[]): string;
	export = PrimitiveNormalizer;
}
