import { permissions } from '@balena/pinejs';
import { api } from '@balena/pinejs/out/sbvr-api/sbvr-utils';
import * as _ from 'lodash';
import { expect } from './test-lib/chai';
import { version } from './test-lib/versions';

import { supertest } from './test-lib/supertest';
// All of these test device types are not part of the contracts, so we have to include them manually until we stop syncing with S3.
export const addFakeDeviceTypes = async () => {
	await Promise.all(
		[
			{
				id: 991,
				slug: 'dt-with-ignored-release',
				name: 'dt-with-ignored-release',
				is_of__cpu_architecture: 1,
			},
			{
				id: 992,
				slug: 'dt-with-403-ignore-file-release',
				name: 'dt-with-403-ignore-file-release',
				is_of__cpu_architecture: 1,
			},
			{
				id: 993,
				slug: 'dt-with-empty-device-type-json-release',
				name: 'dt-with-empty-device-type-json-release',
				is_of__cpu_architecture: 1,
			},
			{
				id: 994,
				slug: 'dt-with-404-device-type-json-release',
				name: 'dt-with-404-device-type-json-release',
				is_of__cpu_architecture: 1,
			},
			{
				id: 995,
				slug: 'dt-with-500-ignore-file-release',
				name: 'dt-with-500-ignore-file-release',
				is_of__cpu_architecture: 1,
			},
			{
				id: 996,
				slug: 'dt-with-500-device-type-json-release',
				name: 'dt-with-500-device-type-json-release',
				is_of__cpu_architecture: 1,
			},
			{
				id: 997,
				slug: 'dt-with-no-valid-releases',
				name: 'dt-with-no-valid-releases',
				is_of__cpu_architecture: 1,
			},
			{
				id: 998,
				slug: 'dt-with-failing-listing',
				name: 'dt-with-failing-listing',
				is_of__cpu_architecture: 1,
			},
		].map(async (dt) => {
			await api.resin.post({
				resource: 'device_type',
				passthrough: {
					req: permissions.root,
				},
				options: { returnResource: false },
				body: dt,
			});
		}),
	);
};

describe('device type endpoints', () => {
	describe('device type resource', () => {
		it('should succeed to return a result', async () => {
			const res = await supertest().get(`/${version}/device_type`).expect(200);
			expect(res.body.d).to.be.an('array');
			res.body.d.forEach((deviceType: any) => {
				expect(deviceType).to.be.an('object');
				expect(deviceType).to.have.property('slug').that.is.a('string');
				expect(deviceType).to.have.property('name').that.is.a('string');
			});

			expect(res.body.d).to.have.property('length', 13);
		});
	});

	describe('/device-types/v1', () => {
		before(async () => {
			await addFakeDeviceTypes();
		});

		it('should succeed to return a result', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			res.body.forEach((deviceType: any) => {
				expect(deviceType).to.be.an('object');
				expect(deviceType).to.have.property('slug').that.is.a('string');
				if (deviceType.slug !== 'edge') {
					expect(deviceType).to.have.property('version').that.is.a('number');
				}
				if (_.has(deviceType, 'aliases')) {
					expect(deviceType).to.have.property('aliases').that.is.an('array');
				}
				expect(deviceType).to.have.property('name').that.is.a('string');
				expect(deviceType).to.have.property('arch').that.is.a('string');
				expect(deviceType).to.have.property('state').that.is.a('string');
				expect(deviceType).to.have.property('buildId').that.is.a('string');
			});
		});

		it('should omit releases that have an IGNORE file', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-ignored-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should omit releases that have an IGNORE file that gives an unauthorized error', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-403-ignore-file-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should omit releases that have an empty device-type.json', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-empty-device-type-json-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should omit releases that do not have a device-type.json', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-404-device-type-json-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should succeed and omit releases that the retrieval of the IGNORE file fails', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-500-ignore-file-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should succeed and omit releases that the retrieval of device-type.json fails', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-500-device-type-json-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should succeed and omit device types whose details fail to be retrieved', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const deviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-500-device-type-json-release',
			);
			expect(deviceType).to.be.an('object');
			expect(deviceType).to.have.property('buildId', '2.0.1+rev1.prod');
		});

		it('should not contain device types with no valid releases', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const emptyDeviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-no-valid-releases',
			);
			expect(emptyDeviceType).to.be.undefined;
		});

		it('should not contain device types whose details fail to be retrieved', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			const emptyDeviceType = _.find(
				res.body,
				({ slug }) => slug === 'dt-with-failing-listing',
			);
			expect(emptyDeviceType).to.be.undefined;
		});

		it('should return a proper result', async () => {
			const res = await supertest().get('/device-types/v1').expect(200);
			expect(res.body).to.be.an('array');
			expect(res.body).to.have.property('length', 15);
			const rpi3config = _.find(res.body, { slug: 'raspberrypi3' });
			expect(rpi3config).to.be.an('object');
			expect(rpi3config).to.have.property('buildId', '2.19.0+rev1.prod');
		});
	});

	describe('/device-types/v1/:deviceType', () => {
		it('should return a proper result', async () => {
			const res = await supertest()
				.get('/device-types/v1/raspberrypi3')
				.expect(200);
			expect(res.body).to.be.an('object');
			expect(res.body).to.have.property('slug', 'raspberrypi3');
			expect(res.body).to.have.property('version', 1);
			expect(res.body)
				.to.have.property('aliases')
				.that.deep.equals(['raspberrypi3']);
			expect(res.body).to.have.property('name', 'Raspberry Pi 3');
			expect(res.body).to.have.property('arch', 'armv7hf');
			expect(res.body).to.have.property('state', 'RELEASED');
			expect(res.body).to.have.property('buildId', '2.19.0+rev1.prod');
		});

		it('should show devices types for aliases as well', async () => {
			const res = await supertest()
				.get('/device-types/v1/raspberrypi')
				.expect(200);
			expect(res.body).to.be.an('object');
			expect(res.body).to.have.property('slug', 'raspberry-pi');
			expect(res.body).to.have.property('version', 1);
			expect(res.body)
				.to.have.property('aliases')
				.that.deep.equals(['raspberrypi']);
			expect(res.body).to.have.property('name', 'Raspberry Pi (v1 and Zero)');
			expect(res.body).to.have.property('arch', 'rpi');
			expect(res.body).to.have.property('state', 'RELEASED');
			expect(res.body).to.have.property('buildId', '2.19.0+rev1.prod');
		});

		it('should include the logoUrl only when an icon is available', async () => {
			const { body: rpi3Config } = await supertest()
				.get('/device-types/v1/raspberrypi3')
				.expect(200);
			expect(rpi3Config).to.have.property(
				'logoUrl',
				'https://files_host.com/images/raspberrypi3/2.19.0%2Brev1.prod/logo.svg',
			);

			const { body: rpiConfig } = await supertest()
				.get('/device-types/v1/raspberry-pi')
				.expect(200);
			expect(rpiConfig).to.not.have.property('logoUrl');
		});
	});

	describe('/device-types/v1/:deviceType/images', () => {
		it('should return a proper result', async () => {
			const res = await supertest()
				.get('/device-types/v1/raspberrypi3-64/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: [
					'2.0.2+rev2',
					'2.0.2+rev2.dev',
					'2.0.2+rev1',
					'2.0.2+rev1.dev',
				],
				latest: '2.0.2+rev2',
			});
		});

		it('should return a proper result for an alias', async () => {
			const res = await supertest()
				.get('/device-types/v1/raspberrypi364/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: [
					'2.0.2+rev2',
					'2.0.2+rev2.dev',
					'2.0.2+rev1',
					'2.0.2+rev1.dev',
				],
				latest: '2.0.2+rev2',
			});
		});

		it('should omit releases that have an IGNORE file', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-ignored-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});

		it('should omit releases that have an IGNORE file that gives an unauthorized error', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-403-ignore-file-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});

		it('should omit releases that have an empty device-type.json', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-empty-device-type-json-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});

		it('should omit releases that do not have a device-type.json', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-404-device-type-json-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});

		it('should succeed and omit releases that the retrieval of the IGNORE file fails', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-500-ignore-file-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});

		it('should succeed and omit releases that the retrieval of device-type.json fails', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-500-device-type-json-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});

		it('should succeed and omit device types whose details fail to be retrieved', async () => {
			const res = await supertest()
				.get('/device-types/v1/dt-with-500-device-type-json-release/images')
				.expect(200);
			expect(res.body).to.deep.equal({
				versions: ['2.0.1+rev1.prod', '2.0.0+rev1.prod'],
				latest: '2.0.1+rev1.prod',
			});
		});
	});
});
