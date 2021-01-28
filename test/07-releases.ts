import * as _ from 'lodash';
import * as fixtures from './test-lib/fixtures';
import { expect } from './test-lib/chai';

import { supertest, UserObjectParam } from './test-lib/supertest';

describe('releases', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let newRelease: AnyObject;

	before(async () => {
		fx = await fixtures.load('07-releases');
		user = fx.users.admin;
		newRelease = {
			belongs_to__application: fx.applications.app1.id,
			commit: '57d00829-492d-4124-bca2-fde28df9e590',
			status: 'success',
			composition: {},
			source: 'test',
			start_timestamp: Date.now(),
		};
	});
	after(async () => {
		await fixtures.clean(fx);
	});

	it('should be able to create a new failed release for a given commit', async () => {
		await supertest(user)
			.post(`/resin/release`)
			.send({
				...newRelease,
				status: 'error',
			})
			.expect(201);
	});

	it('should be able to create an extra failed release for the same commit', async () => {
		await supertest(user)
			.post(`/resin/release`)
			.send({
				...newRelease,
				status: 'error',
			})
			.expect(201);
	});

	it('should be able to create a new successful release for the same commit', async () => {
		await supertest(user).post(`/resin/release`).send(newRelease).expect(201);
	});

	it('should disallow creating an additional successful release for the same commit', async () => {
		const { body } = await supertest(user)
			.post(`/resin/release`)
			.send(newRelease)
			.expect(400);
		expect(body).that.equals(
			'It is necessary that each release1 that has a status that is equal to "success" and has a commit1, belongs to an application that owns exactly one release2 that has a status that is equal to "success" and has a commit2 that is equal to the commit1.',
		);
	});

	it('should be able to create a new successful release for the same commit in a different application', async () => {
		await supertest(user)
			.post(`/resin/release`)
			.send({
				...newRelease,
				belongs_to__application: fx.applications.app2.id,
			})
			.expect(201);
	});
});

describe('versioning releases', () => {
	let fx: fixtures.Fixtures;
	let user: UserObjectParam;
	let release1: AnyObject;
	let release2: AnyObject;
	let newRelease: AnyObject;

	before(async () => {
		fx = await fixtures.load('07-releases');
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
		const res = await supertest(user)
			.get(`/resin/release?$filter=release_version ne null`)
			.expect(200);
		expect(res.body.d).to.have.lengthOf(2);
		(res.body.d as AnyObject[]).forEach((release) => {
			expect(release).to.have.property('release_version').that.is.a('string');
		});
	});

	it('should succeed to return unversioned releases', async () => {
		const res = await supertest(user)
			.get(`/resin/release?$filter=release_version eq null`)
			.expect(200);
		expect(res.body.d).to.have.lengthOf(2);
		(res.body.d as AnyObject[]).forEach((release) => {
			expect(release).to.have.property('release_version').that.is.null;
		});
	});

	it('should succeed in PATCHing a release version', async () => {
		const releaseVersion = 'v1.2.3';
		await supertest(user)
			.patch(`/resin/release(${release1.id})`)
			.send({
				release_version: releaseVersion,
			})
			.expect(200);
		const res = await supertest(user)
			.get(`/resin/release(${release1.id})`)
			.expect(200);
		expect(res.body.d[0])
			.to.have.property('release_version')
			.that.equals(releaseVersion);
	});

	it('should fail to PATCH a duplicate release version', async () => {
		const releaseVersion = 'v1.2.3';
		await supertest(user)
			.patch(`/resin/release(${release2.id})`)
			.send({
				release_version: releaseVersion,
			})
			.expect(400);
	});

	it('should succeed in PATCHing a null release version', async () => {
		await supertest(user)
			.patch(`/resin/release(${release2.id})`)
			.send({
				release_version: null,
			})
			.expect(200);
	});

	it('should confirm that a new release can be created with version', async () => {
		await supertest(user).post(`/resin/release`).send(newRelease).expect(201);
	});

	it('should disallow creating a new release with used version', async () => {
		await supertest(user).post(`/resin/release`).send(newRelease).expect(400);
	});

	it('should confirm that invalidating a release allows reuse of version', async () => {
		await supertest(user)
			.patch(`/resin/release(${release1.id})`)
			.send({
				is_invalidated: true,
			})
			.expect(200);
		await supertest(user)
			.patch(`/resin/release(${release2.id})`)
			.send({
				release_version: release1.release_version,
			})
			.expect(200);
	});
});
