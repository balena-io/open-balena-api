import { expect } from 'chai';
import { sbvrUtils, permissions } from '@balena/pinejs';
import * as fixtures from './test-lib/fixtures';
import { supertest } from './test-lib/supertest';
import {
	checkFileExists,
	expectEqualBlobs,
} from './test-lib/fileupload-helper';
import { version } from './test-lib/versions';

const { api } = sbvrUtils;

describe('release asset', function () {
	describe('create release asset', function () {
		before(async function () {
			const fx = await fixtures.load('23-release-asset/create-release-asset');

			this.loadedFixtures = fx;
			this.user = fx.users.admin;
			this.release1 = fx.releases.release1;
			this.release2 = fx.releases.release2;
			this.release3 = fx.releases.release3;
		});

		after(async function () {
			await api.resin.delete({
				resource: 'release_asset',
				passthrough: { req: permissions.root },
				options: {
					$filter: {
						release: {
							$in: [this.release1.id, this.release2.id, this.release3.id],
						},
					},
				},
			});
			await fixtures.clean(this.loadedFixtures);
		});

		const filePath = `${__dirname}/fixtures/23-release-asset/sample.txt`;
		it('should succeed with mandatory properties', async function () {
			const res = await supertest(this.user)
				.post(`/${version}/release_asset`)
				.field('release', this.release1.id)
				.field('asset_key', 'unique_key_1')
				.attach('asset', filePath, {
					filename: 'sample.txt',
					contentType: 'text/plain',
				})
				.expect(201);

			expect(res.body).to.have.property('id').that.is.a('number');
			expect(res.body)
				.to.have.nested.property('asset.href')
				.that.is.a('string');
			expect(res.body)
				.to.have.nested.property('release.__id')
				.that.equals(this.release1.id);
			expect(res.body.asset_key).to.be.equal('unique_key_1');

			const href = res.body.asset.href;
			expect(await checkFileExists(href, 450)).to.be.eq(true);
			await expectEqualBlobs(href, filePath);
		});

		it('should succeed with same key for a different release', async function () {
			const res = await supertest(this.user)
				.post(`/${version}/release_asset`)
				.field('release', this.release3.id)
				.field('asset_key', 'unique_key_1')
				.attach('asset', filePath, {
					filename: 'sample.txt',
					contentType: 'text/plain',
				})
				.expect(201);

			expect(res.body).to.have.property('id').that.is.a('number');
			expect(res.body)
				.to.have.nested.property('asset.href')
				.that.is.a('string');
			expect(res.body)
				.to.have.nested.property('release.__id')
				.that.equals(this.release3.id);
			expect(res.body.asset_key).to.be.equal('unique_key_1');

			const href = res.body.asset.href;
			expect(await checkFileExists(href, 450)).to.be.eq(true);
			await expectEqualBlobs(href, filePath);
		});

		it('should fail when using duplicated key for that release', async function () {
			await supertest(this.user)
				.post(`/${version}/release_asset`)
				.field('release', this.release1.id)
				.field('asset_key', 'unique_key_1')
				.attach('asset', filePath, {
					filename: 'sample.txt',
					contentType: 'text/plain',
				})
				.expect(409, '"\\"release\\" and \\"asset_key\\" must be unique."');
		});

		it('should fail when not passing release', async function () {
			await supertest(this.user)
				.post(`/${version}/release_asset`)
				.field('release_key', 'unique_key_2')
				.attach('asset', filePath, {
					filename: 'sample.txt',
					contentType: 'text/plain',
				})
				.expect(500); // This should ideally be 4xx
		});

		it('should fail when not passing release asset key', async function () {
			await supertest(this.user)
				.post(`/${version}/release_asset`)
				.field('release', this.release1.id)
				.attach('asset', filePath, {
					filename: 'sample.txt',
					contentType: 'text/plain',
				})
				.expect(500); // This should ideally be 4xx
		});
	});

	describe('retrieve release assets', function () {
		before(async function () {
			const fx = await fixtures.load('23-release-asset/retrieve-release-asset');
			this.loadedFixtures = fx;
			this.user = fx.users.admin;
			this.releaseasset1 = fx.release_asset.releaseasset1;
			this.release1 = fx.releases.release1;
		});

		after(async function () {
			await fixtures.clean(this.loadedFixtures);
		});

		it('should succeed when retrieving all assets', async function () {
			const res = await supertest(this.user)
				.get(
					`/${version}/release_asset?$select=id,release,asset&$orderby=release asc`,
				)
				.expect(200);

			expect(res.body).to.have.property('d').that.is.an('array');
			expect(res.body).to.have.nested.property('d.length', 3);
			expect(res.body).to.have.nested.property('d[0].id').that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[0].release.__id')
				.that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[0].asset.href')
				.that.is.a('string');

			expect(res.body).to.have.nested.property('d[1].id').that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[1].release.__id')
				.that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[1].asset.href')
				.that.is.a('string');

			expect(res.body).to.have.nested.property('d[2].id').that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[2].release.__id')
				.that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[2].asset.href')
				.that.is.a('string');
		});

		it('should succeed when requesting a specific release_asset', async function () {
			const res = await supertest(this.user)
				.get(
					`/${version}/release_asset(${this.releaseasset1.id})?$select=id,release,asset`,
				)
				.expect(200);

			expect(res.body).to.have.property('d').that.is.an('array');
			expect(res.body).to.have.nested.property('d.length', 1);
			expect(res.body)
				.to.have.nested.property('d[0].id')
				.that.equals(this.releaseasset1.id);
			expect(res.body)
				.to.have.nested.property('d[0].asset.href')
				.that.equals(this.releaseasset1.asset.href);
			expect(res.body)
				.to.have.nested.property('d[0].release.__id')
				.that.equals(this.releaseasset1.release.__id);
		});

		it('should succeed when expanding a release', async function () {
			const res = await supertest(this.user)
				.get(
					`/${version}/release(${this.release1.id})?$select=release_asset&$expand=release_asset($select=id,release,asset)`,
				)
				.expect(200);

			expect(res.body).to.have.property('d').that.is.an('array');
			expect(res.body).to.have.nested.property('d.length', 1);
			expect(res.body).to.have.nested.property('d[0]').that.is.an('object');
			expect(res.body)
				.to.have.nested.property('d[0].release_asset')
				.that.is.an('array');
			expect(res.body).to.have.nested.property('d[0].release_asset.length', 2);
			expect(res.body)
				.to.have.nested.property('d[0].release_asset[0].id')
				.that.is.a('number');
			expect(res.body)
				.to.have.nested.property('d[0].release_asset[1].id')
				.that.is.a('number');
		});

		it('should succeed when expanding a release_asset', async function () {
			const res = await supertest(this.user)
				.get(
					`/${version}/release_asset(${this.releaseasset1.id})?$select=release&$expand=release($select=id)`,
				)
				.expect(200);

			expect(res.body).to.have.property('d').that.is.an('array');
			expect(res.body).to.have.nested.property('d.length', 1);
			expect(res.body)
				.to.have.nested.property('d[0].release[0].id')
				.that.equals(this.releaseasset1.release.__id);
		});
	});

	describe('update release_asset', function () {
		before(async function () {
			const fx = await fixtures.load('23-release-asset/update-release-asset');
			this.loadedFixtures = fx;
			this.user = fx.users.admin;
			this.releaseasset1 = fx.release_asset.releaseasset1;
			this.releaseasset2 = fx.release_asset.releaseasset2;
		});

		after(async function () {
			await fixtures.clean(this.loadedFixtures);
		});

		const filePath = `${__dirname}/fixtures/23-release-asset/sample.txt`;
		it('should succeed', async function () {
			await supertest(this.user)
				.patch(`/${version}/release_asset(${this.releaseasset1.id})`)
				.attach('asset', filePath, {
					filename: 'sample.txt',
					contentType: 'text/plain',
				})
				.expect(200);

			const res = await supertest(this.user)
				.get(
					`/${version}/release_asset(${this.releaseasset1.id})?$select=id,release,asset`,
				)
				.expect(200);

			expect(res.body).to.have.property('d').that.is.an('array');
			expect(res.body).to.have.nested.property('d.length', 1);
			expect(res.body)
				.to.have.nested.property('d[0].id')
				.that.equals(this.releaseasset1.id);
			expect(res.body)
				.to.have.nested.property('d[0].release.__id')
				.that.equals(this.releaseasset1.release.__id);

			const href = res.body.d[0].asset.href;

			expect(res.body.d[0].asset.size).to.equals(39);
			expect(await checkFileExists(href, 450)).to.be.eq(true);
			await expectEqualBlobs(href, filePath);
		});

		it('should fail to update key if another key has the same name', async function () {
			await supertest(this.user)
				.patch(`/${version}/release_asset(${this.releaseasset1.id})`)
				.field('asset_key', this.releaseasset2.asset_key)
				.expect(409, '"\\"release\\" and \\"asset_key\\" must be unique."');
		});
	});

	describe('delete release asset', function () {
		before(async function () {
			const fx = await fixtures.load('23-release-asset/delete-release-asset');
			this.loadedFixtures = fx;
			this.user = fx.users.admin;
			this.releaseasset1 = fx.release_asset.releaseasset1;
		});

		after(async function () {
			await fixtures.clean(this.loadedFixtures);
		});

		it('should succeed', async function () {
			await supertest(this.user)
				.del(`/${version}/release_asset(${this.releaseasset1.id})`)
				.expect(200);

			const res = await supertest(this.user)
				.get(`/${version}/release_asset(${this.releaseasset1.id})`)
				.expect(200);

			expect(res.body).to.have.nested.property('d.length', 0);
		});
	});
});
