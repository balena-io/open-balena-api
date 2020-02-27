import { getAdminUser, User } from './test-lib/api-helpers';
import { expect } from './test-lib/chai';
import supertest from './test-lib/supertest';

import { app } from '../init';

describe('supervisor release', function() {
	let admin: User;

	before(async () => {
		admin = await getAdminUser();
	});

	it('should allow admins to create supervisor releases', async () => {
		const res = await supertest(app)
			.get(`/resin/device_type?$select=id&$filter=slug eq 'raspberry-pi'`)
			.expect(200);

		expect(res.body)
			.to.have.nested.property('d[0].id')
			.that.is.a('number');

		await supertest(app, admin)
			.post(`/resin/supervisor_release`)
			.send({
				image_name: 'SOME_IMAGE',
				supervisor_version: '1.2.3',
				is_for__device_type: res.body.d[0].id,
			})
			.expect(201);
	});

	let supervisorReleaseId: number;

	it('should allow admins to read the supervisor release', async () => {
		const res = await supertest(app, admin)
			.get(
				'/resin/supervisor_release?$select=id,image_name,supervisor_version,is_for__device_type',
			)
			.expect(200);
		expect(res.body).to.have.nested.property('d.length', 1);
		expect(res.body.d[0]).to.have.nested.property('image_name');
		expect(res.body.d[0]).to.have.nested.property('supervisor_version');
		expect(res.body.d[0]).to.have.nested.property('is_for__device_type');
		supervisorReleaseId = res.body.d[0].id;
	});

	it('should allow admins to delete the supervisor releases', async () => {
		await supertest(app, admin)
			.delete(`/resin/supervisor_release(${supervisorReleaseId})`)
			.expect(200);
	});
});
