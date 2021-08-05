import * as _ from 'lodash';
import * as fixtures from './test-lib/fixtures';
import { expect } from './test-lib/chai';
import { pineTest } from './test-lib/pinetest';

import type { UserObjectParam } from './test-lib/supertest';

describe('target fleets', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let app1: AnyObject;
	let device1: AnyObject;
	let pineUser: typeof pineTest;

	before(async () => {
		fx = await fixtures.load('17-fleets');
		user = fx.users.admin;
		app1 = fx.applications.app1;
		device1 = fx.devices.device1;
		pineUser = pineTest.clone({
			passthrough: { user },
		});
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('should be able to query the fleets', async () => {
		const { body } = await pineUser
			.get({
				resource: 'fleet',
				id: app1.id,
			})
			.expect(200);
		expect(body).to.have.property('app_name', 'app1');
	});

	it('should be able to create a fleet', async () => {
		const { body } = await pineUser
			.post({
				resource: 'fleet',
				body: {
					app_name: 'fleet1',
					organization: app1.organization.__id,
					is_for__device_type: app1.is_for__device_type.__id,
				},
			})
			.expect(201);
		expect(body).to.have.property('app_name', 'fleet1');
	});

	it('should be able to query the fleet types', async () => {
		const { body } = await pineUser
			.get({
				resource: 'fleet_type',
			})
			.expect(200);
		expect(body).to.have.length(1);
	});

	it('should be able to expand to fleet types', async () => {
		const { body } = await pineUser
			.get({
				resource: 'fleet',
				id: app1.id,
				options: {
					$expand: {
						fleet_type: {},
					},
				},
			})
			.expect(200);
		expect(body)
			.to.have.property('fleet_type')
			.that.is.an('array')
			.that.has.length(1);
	});

	it('should be able to expand from a device to a fleet', async () => {
		const { body } = await pineUser
			.get({
				resource: 'device',
				id: device1.id,
				options: {
					$expand: {
						belongs_to__fleet: {},
					},
				},
			})
			.expect(200);
		expect(body)
			.to.have.property('belongs_to__fleet')
			.that.is.an('array')
			.that.has.length(1);
		expect(body.belongs_to__fleet[0]).to.have.property('id', app1.id);
	});

	it('should be able to query the fleet tags', async () => {
		const { body } = await pineUser
			.get({
				resource: 'fleet_tag',
			})
			.expect(200);
		expect(body).to.have.length(1);
	});

	it('should be able to expand to fleet tags', async () => {
		const { body } = await pineUser
			.get({
				resource: 'fleet',
				id: app1.id,
				options: {
					$expand: {
						fleet_tag: {},
					},
				},
			})
			.expect(200);
		expect(body).to.have.property('fleet_tag').that.is.an('array');
	});
});
