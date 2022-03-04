// import { sbvrUtils, permissions } from '@balena/pinejs';
import * as _ from 'lodash';
import { version } from './test-lib/versions';
import * as fixtures from './test-lib/fixtures';
import { supertest, UserObjectParam } from './test-lib/supertest';

import { writeFile } from 'fs/promises';
import { expect } from 'chai';

describe('$metadata resource', () => {
	let admin: UserObjectParam;

	before(async function () {
		const fx = await fixtures.load();
		admin = fx.users.admin;
	});

	it('should return unauthorized guest user schema as odata json', async () => {
		const res = await supertest().get(`/${version}/$metadata`).expect(200);
		expect(res.body)
			.to.be.an('object')
			.to.have.deep.include({ $Version: '4.01' });
		await writeFile('./odata-guest.json', JSON.stringify(res.body, null, 2));
	});

	it('should return unauthorized guest user schema as openapi json', async () => {
		const res = await supertest()
			.get(`/${version}/$metadata`)
			.send({ openapi: true })
			.expect(200);
		expect(res.body)
			.to.be.an('object')
			.to.have.deep.include({ openapi: '3.0.2' });
		expect(res.body).to.have.property('paths');
		Object.values(res?.body?.paths).forEach((path: any) => {
			const properties =
				path?.get?.responses?.['200']?.content?.['application/json']?.schema
					?.properties;
			if (properties) {
				expect(properties).to.have.ownProperty('d');
				expect(properties).to.not.have.ownProperty('value');
			}
		});
		expect(res.body.paths).to.not.have.property('/device');
		await writeFile('./openapi-guest.json', JSON.stringify(res.body, null, 2));
	});

	it('should return unauthorized admin user schema as odata json', async () => {
		const res = await supertest(admin).get(`/${version}/$metadata`).expect(200);
		expect(res.body)
			.to.be.an('object')
			.to.have.deep.include({ $Version: '4.01' });
		await writeFile('./odata-admin.json', JSON.stringify(res.body, null, 2));
	});

	it('should return unauthorized admin user schema as openapi json', async () => {
		const res = await supertest(admin)
			.get(`/${version}/$metadata`)
			.send({ openapi: true })
			.expect(200);
		expect(res.body)
			.to.be.an('object')
			.to.have.deep.include({ openapi: '3.0.2' });
		expect(res.body).to.have.property('paths');
		expect(res.body.paths).to.have.property('/device');
		await writeFile('./openapi-admin.json', JSON.stringify(res.body, null, 2));
	});
});
