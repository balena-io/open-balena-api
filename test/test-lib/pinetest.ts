import { PineTest } from 'pinejs-client-supertest';
import { app } from '../../init.ts';
import type { ValidVersion } from './versions.ts';

export const pineTest: {
	[version in ValidVersion]: PineTest;
} = new Proxy(
	{} as {
		[version in ValidVersion]: PineTest;
	},
	{
		get(target, version: ValidVersion) {
			target[version] ??= new PineTest({ apiPrefix: `${version}/` }, { app });
			return target[version];
		},
	},
);
