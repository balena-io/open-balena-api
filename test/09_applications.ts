import * as _ from 'lodash';
import { expect } from './test-lib/chai';
import { supertest, UserObjectParam } from './test-lib/supertest';
import * as fixtures from './test-lib/fixtures';
import { DefaultApplicationType } from '../src';

describe('application resource', () => {
	let admin: UserObjectParam;
	let org: any;

	before(async function () {
		const fx = await fixtures.load();
		admin = fx.users.admin;
		org = fx.organizations['admin'];
	});

	it('should create a gpu mem envvar for RPI based device types', async () => {
		const dtRes = await supertest().get(
			`/resin/device_type?$filter=slug eq 'raspberrypi3'`,
		);

		const appRes = await supertest(admin)
			.post(`/resin/application`)
			.send({
				organization: org.id,
				app_name: 'app_test_rpi3',
				is_for__device_type: dtRes.body.d[0].id,
				application_type: DefaultApplicationType.id,
			})
			.expect(201);

		const varRes = await supertest(admin).get(
			`/resin/application_config_variable?$filter=application eq ${appRes.body.id}`,
		);
		expect(varRes.body.d[0]).to.not.be.undefined;
		expect(varRes.body.d[0].value).to.equal('16');
	});

	it('should not create a gpu mem envvar for non-RPI based device types', async () => {
		const dtRes = await supertest().get(
			`/resin/device_type?$filter=slug eq 'intel-nuc'`,
		);

		const appRes = await supertest(admin)
			.post(`/resin/application`)
			.send({
				organization: org.id,
				app_name: 'app_test_nuc',
				is_for__device_type: dtRes.body.d[0].id,
				application_type: DefaultApplicationType.id,
			})
			.expect(201);

		const varRes = await supertest(admin).get(
			`/resin/application_config_variable?$filter=application eq ${appRes.body.id}`,
		);
		console.log(varRes.body.d);
		expect(varRes.body.d[0]).to.be.undefined;
	});
});
