import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import { supertest } from './test-lib/supertest.js';
import {
	checkFileExists,
	expectEqualBlobs,
} from './test-lib/fileupload-helper.js';
import * as versions from './test-lib/versions.js';

export default () => {
	versions.test((version) => {
		if (!versions.gt(version, 'v7')) {
			// Release assets were added after v7
			return;
		}
		describe('release asset', function () {
			describe('create release asset', function () {
				before(async function () {
					const fx = await fixtures.load(
						'23-release-asset/create-release-asset',
					);

					this.loadedFixtures = fx;
					this.user = fx.users.admin;
					this.release1 = fx.releases.release1;
					this.release2 = fx.releases.release2;
					this.release3 = fx.releases.release3;
				});

				after(async function () {
					await fixtures.clean(this.loadedFixtures);
				});

				const filePath = fileURLToPath(
					new URL('fixtures/23-release-asset/sample.txt', import.meta.url),
				);

				it('should succeed with empty asset', async function () {
					const res = await supertest(this.user)
						.post(`/${version}/release_asset`)
						.field('release', this.release1.id)
						.field('asset_key', 'unique_key_0')
						.expect(201);

					expect(res.body).to.have.property('id').that.is.a('number');
					expect(res.body).to.have.property('asset').that.is.null;
					expect(res.body)
						.to.have.nested.property('release.__id')
						.that.equals(this.release1.id);
					expect(res.body.asset_key).to.equal('unique_key_0');
				});

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
					expect(res.body.asset_key).to.equal('unique_key_1');

					const href = res.body.asset.href;
					expect(await checkFileExists(href, 450)).to.be.true;
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
					expect(res.body.asset_key).to.equal('unique_key_1');

					const href = res.body.asset.href;
					expect(await checkFileExists(href, 450)).to.be.true;
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

				it('should fail when using a too long filename', async function () {
					await supertest(this.user)
						.post(`/${version}/release_asset`)
						.field('release', this.release1.id)
						.field('asset_key', 'unique_key_1')
						.attach('asset', filePath, {
							filename: 'too_long_file_name.txt'.padStart(300, 'a'),
							contentType: 'text/plain',
						})
						.expect(
							400,
							'"It is necessary that each release asset that has an asset, has an asset that has a Filename (Type) that has a Length (Type) that is less than or equal to 255 and has a Content Type (Type) that has a Length (Type) that is less than or equal to 129."',
						);
				});

				it('should fail when using a too long contentType', async function () {
					await supertest(this.user)
						.post(`/${version}/release_asset`)
						.field('release', this.release1.id)
						.field('asset_key', 'unique_key_1')
						.attach('asset', filePath, {
							filename: 'sample.txt',
							contentType: 'text/plain'.padEnd(300, 'a'),
						})
						.expect(
							400,
							'"It is necessary that each release asset that has an asset, has an asset that has a Filename (Type) that has a Length (Type) that is less than or equal to 255 and has a Content Type (Type) that has a Length (Type) that is less than or equal to 129."',
						);
				});
			});

			describe('retrieve release assets', function () {
				before(async function () {
					const fx = await fixtures.load(
						'23-release-asset/retrieve-release-asset',
					);
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

					expect(res.body)
						.to.have.property('d')
						.that.is.an('array')
						.and.has.length(3);
					expect(res.body)
						.to.have.nested.property('d[0].id')
						.that.is.a('number');
					expect(res.body)
						.to.have.nested.property('d[0].release.__id')
						.that.is.a('number');
					expect(res.body)
						.to.have.nested.property('d[0].asset.href')
						.that.is.a('string');

					expect(res.body)
						.to.have.nested.property('d[1].id')
						.that.is.a('number');
					expect(res.body)
						.to.have.nested.property('d[1].release.__id')
						.that.is.a('number');
					expect(res.body)
						.to.have.nested.property('d[1].asset.href')
						.that.is.a('string');

					expect(res.body)
						.to.have.nested.property('d[2].id')
						.that.is.a('number');
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

					expect(res.body)
						.to.have.property('d')
						.that.is.an('array')
						.and.has.length(1);
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

					expect(res.body)
						.to.have.property('d')
						.that.is.an('array')
						.and.has.length(1);
					expect(res.body).to.have.nested.property('d[0]').that.is.an('object');
					expect(res.body)
						.to.have.nested.property('d[0].release_asset')
						.that.is.an('array');
					expect(res.body)
						.to.have.nested.property('d[0].release_asset')
						.that.has.length(2);
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

					expect(res.body)
						.to.have.property('d')
						.that.is.an('array')
						.and.has.length(1);
					expect(res.body)
						.to.have.nested.property('d[0].release[0].id')
						.that.equals(this.releaseasset1.release.__id);
				});
			});

			describe('update release_asset', function () {
				before(async function () {
					const fx = await fixtures.load(
						'23-release-asset/update-release-asset',
					);
					this.loadedFixtures = fx;
					this.user = fx.users.admin;
					this.releaseasset1 = fx.release_asset.releaseasset1;
					this.releaseasset2 = fx.release_asset.releaseasset2;
				});

				after(async function () {
					await fixtures.clean(this.loadedFixtures);
				});

				const filePath = fileURLToPath(
					new URL('fixtures/23-release-asset/sample.txt', import.meta.url),
				);
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

					expect(res.body)
						.to.have.property('d')
						.that.is.an('array')
						.and.has.length(1);
					const result = res.body.d[0];
					expect(result)
						.to.have.property('id')
						.that.equals(this.releaseasset1.id);
					expect(result)
						.to.have.nested.property('release.__id')
						.that.equals(this.releaseasset1.release.__id);

					const href = result.asset.href;

					expect(result.asset.size).to.equal(39);
					expect(await checkFileExists(href, 450)).to.be.true;
					await expectEqualBlobs(href, filePath);
				});

				it('should fail to update key if another key has the same name', async function () {
					await supertest(this.user)
						.patch(`/${version}/release_asset(${this.releaseasset1.id})`)
						.field('asset_key', this.releaseasset2.asset_key)
						.expect(409, '"\\"release\\" and \\"asset_key\\" must be unique."');
				});

				it('should fail to update key if another key has the same name with application/json body', async function () {
					await supertest(this.user)
						.patch(`/${version}/release_asset(${this.releaseasset1.id})`)
						.send({
							asset_key: this.releaseasset2.asset_key,
						})
						.expect(409, '"\\"release\\" and \\"asset_key\\" must be unique."');
				});

				it('should succeed to update key with a different asset_key name with application/json body', async function () {
					await supertest(this.user)
						.patch(`/${version}/release_asset(${this.releaseasset1.id})`)
						.send({
							asset_key: 'another_asset_key',
						})
						.expect(200);

					const res = await supertest(this.user)
						.get(
							`/${version}/release_asset(${this.releaseasset1.id})?$select=id,asset_key`,
						)
						.expect(200);
					expect(res.body.d[0].asset_key).to.equal('another_asset_key');
				});
			});

			describe('delete release asset', function () {
				before(async function () {
					const fx = await fixtures.load(
						'23-release-asset/delete-release-asset',
					);
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

					expect(res.body).to.have.property('d').that.has.length(0);
				});
			});
		});
	});
};
