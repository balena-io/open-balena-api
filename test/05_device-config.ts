import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures';
import { supertest } from './test-lib/supertest';
import { version } from './test-lib/versions';
import { sbvrUtils, permissions } from '@balena/pinejs';

const { api } = sbvrUtils;

describe('generate device config', function () {
	before(async function () {
		const fx = await fixtures.load('05-device-config');
		this.loadedFixtures = fx;
		this.user = fx.users.admin;
		this.application = fx.applications.app1;
	});

	after(async function () {
		await supertest(this.user).delete(`/${version}/api_key`).expect(200);
		await fixtures.clean(this.loadedFixtures);
	});

	describe('using /download-config', function () {
		it('should be able to create a provisioning key with default name and description', async function () {
			const { body } = await supertest(this.user)
				.get(
					`/download-config?appId=${this.application.id}&version=v2.24.0.dev&deviceType=raspberrypi3`,
				)
				.expect(200)
				.expect('content-type', /^application\/json/);

			expect(body).to.have.a.property('apiKey');
			expect(body.apiKey).to.be.a('string');

			// check the name assigned
			const apiKeyResp = await api.resin.get({
				resource: 'api_key',
				passthrough: {
					req: permissions.root,
				},
				id: {
					key: body.apiKey,
				},
				options: {
					$select: ['name', 'description'],
				},
			});

			expect(apiKeyResp).to.have.property(
				'name',
				'Automatically generated provisioning key',
			);
			expect(apiKeyResp).to.have.property(
				'description',
				'Automatically generated for an image download or config file generation',
			);
		});

		it('should be able to create a provisioning key with specified name and description', async function () {
			const { body } = await supertest(this.user)
				.post('/download-config')
				.send({
					appId: this.application.id,
					version: 'v2.24.0',
					deviceType: 'raspberrypi3',
					provisioningKeyName: `${version}-proivisiong-key`,
					provisioningKeyDescription: `Provisioning Key for app ${this.application.id}`,
				})
				.expect(200)
				.expect('content-type', /^application\/json/);

			expect(body).to.have.a.property('apiKey');
			expect(body.apiKey).to.be.a('string');

			// check the name assigned
			const apiKeyResp = await api.resin.get({
				resource: 'api_key',
				passthrough: {
					req: permissions.root,
				},
				id: {
					key: body.apiKey,
				},
				options: {
					$select: ['name', 'description'],
				},
			});

			expect(apiKeyResp).to.have.property('name', `${version}-proivisiong-key`);
			expect(apiKeyResp).to.have.property(
				'description',
				`Provisioning Key for app ${this.application.id}`,
			);
		});
	});
});
