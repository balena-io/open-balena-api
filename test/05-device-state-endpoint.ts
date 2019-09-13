import 'mocha';
import { Dictionary } from 'lodash';
import { expect } from 'chai';
import { app } from '../init';
import { asAdmin, generateApiKey } from './test-lib/auth';
import * as models from './test-lib/models';

import supertest = require('./test-lib/supertest');
import { connectDeviceAndWaitForUpdate } from './test-lib/connect-device-and-wait';

describe('Device State (v2)', () => {
	describe('Empty', () => {
		let admin = '',
			appId = -1,
			device: { id: number; uuid: string; device_name: string } = {
				id: -1,
				uuid: '',
				device_name: '',
			};

		const appName = 'test-05-empty-app',
			deviceKey = generateApiKey();

		before(async () => {
			admin = await asAdmin(app);

			appId = (await models.createApplication(app, admin, {
				app_name: appName,
				application_type: 0,
				device_type: 'intel-nuc',
			})).body.id as number;

			device = await (await models.createProvisioningKey(
				app,
				admin,
				appId,
			)).createDevice({
				api_key: deviceKey,
				device_type: 'intel-nuc',
				user: 2,
			});
		});

		after(async () => {
			await supertest(app, admin)
				.delete(`/resin/application(${appId})`)
				.expect(200);
		});

		it('should get device state for an empty application', async () => {
			await supertest(app, deviceKey)
				.get(`/device/v2/${device.uuid}/state`)
				.expect(200)
				.then(res => {
					expect(res.body).to.deep.equal({
						local: {
							name: device.device_name,
							config: {
								RESIN_SUPERVISOR_POLL_INTERVAL: '600000',
							},
							apps: {
								[appId]: {
									name: appName,
									services: {},
									volumes: {},
									networks: {},
								},
							},
						},
						dependent: {
							apps: {},
							devices: {},
						},
					});
				});
		});
	});

	describe('With Release', () => {
		let admin = '',
			appId = -1,
			device: { id: number; uuid: string; device_name: string } = {
				id: -1,
				uuid: '',
				device_name: '',
			},
			release: AnyObject = {};

		const appName = 'test-05-with-release',
			deviceKey = generateApiKey();

		before(async () => {
			admin = await asAdmin(app);

			appId = (await models.createApplication(app, admin, {
				app_name: appName,
				application_type: 0,
				device_type: 'intel-nuc',
			})).body.id as number;

			device = await (await models.createProvisioningKey(
				app,
				admin,
				appId,
			)).createDevice({
				api_key: deviceKey,
				device_type: 'intel-nuc',
				user: 2,
			});
		});

		after(async () => {
			await supertest(app, admin)
				.delete(`/resin/application(${appId})`)
				.expect(200);
		});

		it('should get the new device state after a release', async () => {
			release = await models.createRelease(
				app,
				admin,
				{
					belongs_to__application: appId,
					commit: '00000001',
					status: 'pending',
				},
				['main', 'sidecar'],
			);

			// this action would create service_installs for devices which tracked the latest app release...
			await supertest(app, admin)
				.patch(`/resin/release(${release.id})`)
				.send({ status: 'success' })
				.expect(200);

			return supertest(app, deviceKey)
				.get(`/device/v2/${device.uuid}/state`)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('local')
						.that.is.an('object');
					expect(res.body.local)
						.to.have.property('apps')
						.that.is.an('object');
					expect(res.body.local.apps)
						.to.have.property(`${appId}`)
						.that.is.an('object');
					expect(res.body.local.apps[`${appId}`])
						.to.have.property('services')
						.that.is.an('object');

					const { services } = res.body.local.apps[`${appId}`];
					const serviceIds = Object.keys(services).map(id => parseInt(id));

					const { main, sidecar } = release.services as Dictionary<number>;
					expect(Object.keys(services)).to.have.lengthOf(2);
					expect(serviceIds).to.include.members([main, sidecar]);
				});
		});

		it('should get the existing device state during a build', async () => {
			// create a release which is pending the build completion...
			const pendingRelease = await models.createRelease(
				app,
				admin,
				{
					belongs_to__application: appId,
					commit: '00000002',
					status: 'pending',
				},
				['main', 'pudding', 'mints'],
			);

			// the is where the build is happening, so should be getting the state for the last successful release...
			await supertest(app, deviceKey)
				.get(`/device/v2/${device.uuid}/state`)
				.expect(200)
				.then(res => {
					const { services } = res.body.local.apps[`${appId}`];
					const serviceIds = Object.keys(services).map(id => parseInt(id));

					const { main, sidecar } = release.services as Dictionary<number>;

					// this release is still pending, so should return the original 2 services; main and sidecar...
					expect(serviceIds).to.have.lengthOf(2);
					expect(serviceIds).to.include.members([main, sidecar]);
				});

			release = pendingRelease;
		});

		it('should get the new services once the build is done', async () => {
			await supertest(app, admin)
				.patch(`/resin/release(${release.id})`)
				.send({ status: 'success' })
				.expect(200);

			await supertest(app, deviceKey)
				.get(`/device/v2/${device.uuid}/state`)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('local')
						.that.is.an('object');
					expect(res.body.local)
						.to.have.property('apps')
						.that.is.an('object');
					expect(res.body.local.apps)
						.to.have.property(`${appId}`)
						.that.is.an('object');
					expect(res.body.local.apps[`${appId}`])
						.to.have.property('services')
						.that.is.an('object');

					const { services } = res.body.local.apps[`${appId}`];
					const serviceIds = Object.keys(services).map(id => parseInt(id));

					const { main, pudding, mints } = release.services as Dictionary<
						number
					>;
					// this release was a success, so should return the new 3 services; main, pudding and mints...
					expect(Object.keys(services)).to.have.lengthOf(3);
					expect(serviceIds).to.include.members([main, pudding, mints]);
				});
		});

		it('should return device-service environment variables if they are set', async () => {
			const addDeviceServiceEnvVar = async (
				device: number,
				service: number,
				name: string,
				value: string,
			) => {
				await supertest(app, admin)
					.post('/resin/device_service_environment_variable')
					.set('Content-Type', 'application/json')
					.send({
						belongs_to__device: device,
						applies_to__service: service,
						name,
						value,
					})
					.expect(201);
			};

			await connectDeviceAndWaitForUpdate(device.uuid, async () => {
				await addDeviceServiceEnvVar(
					device.id,
					release.services['main'],
					'main_var',
					'abcde',
				);
				await addDeviceServiceEnvVar(
					device.id,
					release.services['pudding'],
					'pudding_var',
					'fghij',
				);
				await addDeviceServiceEnvVar(
					device.id,
					release.services['mints'],
					'mints_var',
					'klmno',
				);
			});

			await supertest(app, deviceKey)
				.get(`/device/v2/${device.uuid}/state`)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('local')
						.that.is.an('object');
					expect(res.body.local)
						.to.have.property('apps')
						.that.is.an('object');
					expect(res.body.local.apps)
						.to.have.property(`${appId}`)
						.that.is.an('object');
					expect(res.body.local.apps[`${appId}`])
						.to.have.property('services')
						.that.is.an('object');

					const { services } = res.body.local.apps[`${appId}`];

					expect(services[`${release.services['main']}`])
						.to.have.property('environment')
						.that.is.an('object');
					expect(services[`${release.services['main']}`].environment)
						.to.have.property('main_var')
						.that.equals('abcde');

					expect(services[`${release.services['pudding']}`])
						.to.have.property('environment')
						.that.is.an('object');
					expect(services[`${release.services['pudding']}`].environment)
						.to.have.property('pudding_var')
						.that.equals('fghij');

					expect(services[`${release.services['mints']}`])
						.to.have.property('environment')
						.that.is.an('object');
					expect(services[`${release.services['mints']}`].environment)
						.to.have.property('mints_var')
						.that.equals('klmno');
				});
		});
	});
});
