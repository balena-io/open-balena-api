import type Model from '../balena-model.js';

declare module '@balena/pinejs' {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace sbvrUtils {
		export interface API {
			resin: PinejsClient<Model>;
			[vocab: string]: PinejsClient;
		}
	}
}
