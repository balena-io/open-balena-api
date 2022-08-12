import * as _ from 'lodash';
// import { expect } from './test-lib/chai';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import * as fixtures from './test-lib/fixtures';
import * as fs from 'fs';

(['v2', 'v3'] as const).forEach((stateVersion) =>
	describe(`Device State ${stateVersion}`, () => {
		let fx: fixtures.Fixtures;
		let admin: UserObjectParam;

		before(async () => {
			fx = await fixtures.load('03-device-state');
			admin = fx.users.admin;
		});

		after(async () => {
			await fixtures.clean(fx);
		});

		describe(`API heartbeat state`, () => {
			it('check /example/$metadata is served by pinejs', async () => {
				const res = await supertest(admin)
					.get(`/${version}/$metadata`)
					.send({ openapi: true })
					.expect(200);
				// expect(res.body.paths).to.be.an('object');
				// console.log(res.body.paths);
				// expect(res.body.paths).to.have.property('/device');
				// expect(res.body.paths).to.have.property('/application');
				await fs.writeFileSync(
					'example-openapi.json',
					JSON.stringify(res.body, null, 2),
				);
			});
		});
	}),
);
