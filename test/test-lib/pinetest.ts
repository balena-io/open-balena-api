import { PineTest } from 'pinejs-client-supertest';
import { app } from '../../init';
import type { ValidVersion } from './versions';
import { versions } from './versions';

const pineTest: {
	[version in ValidVersion]: PineTest;
} = {} as any;
for (const v of versions) {
	pineTest[v] = new PineTest({ apiPrefix: `${v}/` }, { app });
}
export { pineTest };
