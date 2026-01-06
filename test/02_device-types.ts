import { sbvrUtils, permissions } from '@balena/pinejs';
import _ from 'lodash';
import { expect } from 'chai';
import * as versions from './test-lib/versions.js';

import { supertest } from './test-lib/supertest.js';
// All of these test device types are not part of the contracts, so we have to include them manually until we stop syncing with S3.
const addFakeDeviceTypes = () => {
	let fakeDeviceTypeIds: number[];

	before(async () => {
		const rootApi = sbvrUtils.api.resin.clone({
			passthrough: {
				req: permissions.root,
			},
		});

		fakeDeviceTypeIds = await Promise.all(
			[
				'dt-with-ignored-release',
				'dt-with-403-ignore-file-release',
				'dt-with-empty-device-type-json-release',
				'dt-with-404-device-type-json-release',
				'dt-with-500-ignore-file-release',
				'dt-with-500-device-type-json-release',
				'dt-with-no-valid-releases',
			].map(async (slug, i) => {
				const deviceType = await rootApi.post({
					resource: 'device_type',
					body: {
						id: 990 + i,
						slug,
						name: slug,
						is_of__cpu_architecture: 1,
					},
				});

				await Promise.all(
					[slug, `${slug}-alias`].map(async (alias) => {
						await rootApi.post({
							resource: 'device_type_alias',
							options: { returnResource: false },
							body: {
								device_type: deviceType.id,
								is_referenced_by__alias: alias,
							},
						});
					}),
				);

				return deviceType.id;
			}),
		);
	});

	after(async () => {
		const rootApi = sbvrUtils.api.resin.clone({
			passthrough: {
				req: permissions.root,
			},
		});

		await rootApi.delete({
			resource: 'device_type_alias',
			options: {
				$filter: {
					device_type: { $in: fakeDeviceTypeIds },
				},
			},
		});

		await rootApi.delete({
			resource: 'device_type',
			options: {
				$filter: {
					id: { $in: fakeDeviceTypeIds },
				},
			},
		});
	});
};

export default () => {
	versions.test((version) => {
		describe('device type resource', () => {
			it('should succeed to return a result', async () => {
				const res = await supertest()
					.get(`/${version}/device_type`)
					.expect(200);
				expect(res.body.d).to.be.an('array');
				res.body.d.forEach((deviceType: any) => {
					expect(deviceType).to.be.an('object');
					expect(deviceType).to.have.property('slug').that.is.a('string');
					expect(deviceType).to.have.property('name').that.is.a('string');
				});

				expect(res.body.d).to.have.property('length', 16);
			});
		});
	});

	describe('device type endpoints', () => {
		addFakeDeviceTypes();

		describe('/device-types/v1', () => {
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
				expect(res.body).to.have.property('length', 17);
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
	});
};
