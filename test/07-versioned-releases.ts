import * as _ from 'lodash';
import 'mocha';
import { app } from '../init';
import * as fixtures from './test-lib/fixtures';
import { expect } from './test-lib/chai';

import { supertest, UserObjectParam } from './test-lib/supertest';

describe('versioning releases', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let release1: AnyObject;
	let release2: AnyObject;
	let newRelease: AnyObject;

	before(async () => {
		fx = await fixtures.load('07-versioned-releases');
		user = fx.users.admin;
		release1 = fx.releases.release1;
		release2 = fx.releases.release2;
		newRelease = {
			belongs_to__application: fx.applications.app1.id,
			commit: 'test-commit',
			status: 'success',
			release_version: 'v10.1.1',
			composition: {},
			source: 'test',
			start_timestamp: Date.now(),
		};
	});

	after(async () => {
		await fixtures.clean(fx);
	});

	it('should succeed to return versioned releases', async () => {
		const res = await supertest(app, user)
			.get(`/resin/release?$filter=release_version ne null`)
			.expect(200);
		expect(res.body.d).to.have.lengthOf(2);
		(res.body.d as AnyObject[]).forEach((release) => {
			expect(release).to.have.property('release_version').that.is.a('string');
		});
	});

	it('should succeed to return unversioned releases', async () => {
		const res = await supertest(app, user)
			.get(`/resin/release?$filter=release_version eq null`)
			.expect(200);
		expect(res.body.d).to.have.lengthOf(2);
		(res.body.d as AnyObject[]).forEach((release) => {
			expect(release).to.have.property('release_version').that.is.null;
		});
	});

	it('should succeed in PATCHing a release version', async () => {
		const releaseVersion = 'v1.2.3';
		await supertest(app, user)
			.patch(`/resin/release(${release1.id})`)
			.send({
				release_version: releaseVersion,
			})
			.expect(200);
		const res = await supertest(app, user)
			.get(`/resin/release(${release1.id})`)
			.expect(200);
		expect(res.body.d[0])
			.to.have.property('release_version')
			.that.equals(releaseVersion);
	});

	it('should fail to PATCH a duplicate release version', async () => {
		const releaseVersion = 'v1.2.3';
		await supertest(app, user)
			.patch(`/resin/release(${release2.id})`)
			.send({
				release_version: releaseVersion,
			})
			.expect(400);
	});

	it('should succeed in PATCHing a null release version', async () => {
		await supertest(app, user)
			.patch(`/resin/release(${release2.id})`)
			.send({
				release_version: null,
			})
			.expect(200);
	});

	it('should confirm that a new release can be created with version', async () => {
		await supertest(app, user)
			.post(`/resin/release`)
			.send(newRelease)
			.expect(201);
	});

	it('should disallow creating a new release with used version', async () => {
		await supertest(app, user)
			.post(`/resin/release`)
			.send(newRelease)
			.expect(400);
	});

	it('should confirm that invalidating a release allows reuse of version', async () => {
		await supertest(app, user)
			.patch(`/resin/release(${release1.id})`)
			.send({
				is_invalidated: true,
			})
			.expect(200);
		await supertest(app, user)
			.patch(`/resin/release(${release2.id})`)
			.send({
				release_version: release1.release_version,
			})
			.expect(200);
	});
});
