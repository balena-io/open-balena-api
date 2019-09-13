import 'mocha';
import { expect } from 'chai';
import { app } from '../init';
import { asAdmin } from './test-lib/auth';
import * as models from './test-lib/models';

import supertest = require('./test-lib/supertest');

import { connectDeviceAndWaitForUpdate } from './test-lib/connect-device-and-wait';

describe('Environment Variables', () => {
	let admin = '',
		device = -1,
		deviceUuid = '',
		application = -1,
		release: AnyObject = {};

	const deviceType = 'intel-nuc';

	before(async () => {
		admin = await asAdmin(app);

		application = (await models.createApplication(app, admin, {
			app_name: 'test-06-env-vars',
			application_type: 0,
			device_type: deviceType,
		})).body.id as number;

		const { id, uuid } = (await models.createDevice(app, admin, {
			belongs_to__application: application,
			device_type: deviceType,
		})).body;
		device = id;
		deviceUuid = uuid;

		release = await models.createRelease(
			app,
			admin,
			{
				belongs_to__application: application,
				commit: '06000001',
				status: 'success',
			},
			['main', 'sidecar'],
		);
	});

	after(async () => {
		await supertest(app, admin)
			.delete(`/resin/application(${application})`)
			.expect(200);
	});

	describe('Service Environment Variables', () => {
		it('should have no service environent variables by default', async () => {
			await supertest(app, admin)
				.get(
					`/resin/service_environment_variable?$filter=service eq ${release.services['main']}`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(0);
				});
		});

		it('should create a service environent variable for the main service', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.post('/resin/service_environment_variable')
					.send({
						name: 'service_env_var_1',
						value: 'abcde',
						service: release.services['main'],
					})
					.expect(201);
			});

			await supertest(app, admin)
				.get(
					`/resin/service_environment_variable?$filter=service eq ${release.services['main']}&$expand=service`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property('name', 'service_env_var_1');
					expect(res.body.d[0]).to.have.property('value', 'abcde');
					expect(res.body.d[0])
						.to.have.property('service')
						.that.is.an('array');
					expect(res.body.d[0].service).to.have.lengthOf(1);
					expect(res.body.d[0].service[0]).to.have.property(
						'id',
						release.services['main'],
					);
				});
		});

		it('should update a service environent variable for the main service', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.patch(
						`/resin/service_environment_variable?$filter=name eq 'service_env_var_1' and service eq ${release.services['main']}&$expand=service`,
					)
					.send({
						value: 'vwxyz',
					})
					.expect(200);
			});

			await supertest(app, admin)
				.get(
					`/resin/service_environment_variable?$filter=service eq ${release.services['main']}&$expand=service`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property('name', 'service_env_var_1');
					expect(res.body.d[0]).to.have.property('value', 'vwxyz');
					expect(res.body.d[0])
						.to.have.property('service')
						.that.is.an('array');
					expect(res.body.d[0].service).to.have.lengthOf(1);
					expect(res.body.d[0].service[0]).to.have.property(
						'id',
						release.services['main'],
					);
				});
		});
	});

	describe('Device Environment Variables', () => {
		it('should have no device environent variables by default', async () => {
			await supertest(app, admin)
				.get(`/resin/device_environment_variable?$filter=device eq ${device}`)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(0);
				});
		});

		it('should create a device environment variable', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.post('/resin/device_environment_variable')
					.send({
						name: 'device_env_var_1',
						value: 'abcde',
						device,
					})
					.expect(201);
			});

			await supertest(app, admin)
				.get(
					`/resin/device_environment_variable?$filter=device eq ${device}&$expand=device`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property('name', 'device_env_var_1');
					expect(res.body.d[0]).to.have.property('value', 'abcde');
					expect(res.body.d[0])
						.to.have.property('device')
						.that.is.an('array');
					expect(res.body.d[0].device).to.have.lengthOf(1);
					expect(res.body.d[0].device[0]).to.have.property('id', device);
				});
		});

		it('should update a device environment variable', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.patch(
						`/resin/device_environment_variable?$filter=device eq ${device}&$expand=device`,
					)
					.send({
						value: 'vwxyz',
					})
					.expect(200);
			});

			await supertest(app, admin)
				.get(
					`/resin/device_environment_variable?$filter=device eq ${device}&$expand=device`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property('name', 'device_env_var_1');
					expect(res.body.d[0]).to.have.property('value', 'vwxyz');
				});
		});
	});

	describe('Device-Service Environment Variables', () => {
		it('should have no device-service environent variables by default', async () => {
			return supertest(app, admin)
				.get(
					`/resin/device_service_environment_variable?$filter=belongs_to__device eq ${device}`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.length(0);
				});
		});

		it('create a new device-service environent variable with existing service_install', async () => {
			const serviceInstall = await supertest(app, admin)
				.post('/resin/service_install')
				.send({
					device,
					installs__service: release.services['main'],
				})
				.expect(201)
				.then(res => res.body.id as number);

			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.post('/resin/device_service_environment_variable')
					.set('Content-Type', 'application/json')
					.send({
						service_install: serviceInstall,
						name: 'test_2',
						value: 'burgers',
					})
					.expect(201);
			});

			const varId = await supertest(app, admin)
				.get(
					`/resin/device_service_environment_variable?$filter=belongs_to__device eq ${device}`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.length(1);
					expect(res.body.d[0])
						.to.have.property('name')
						.equal('test_2');
					expect(res.body.d[0])
						.to.have.property('value')
						.equal('burgers');

					return res.body.d[0].id as number;
				});

			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.delete(`/resin/device_service_environment_variable(${varId})`)
					.expect(200);
			});
		});

		it('create a new device-service environent variable with device/service IDs', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.post('/resin/device_service_environment_variable')
					.set('Content-Type', 'application/json')
					.send({
						belongs_to__device: device,
						applies_to__service: release.services['sidecar'] as number,
						name: 'test_1',
						value: 'hotdogs',
					})
					.expect(201);
			});

			const varId = await supertest(app, admin)
				.get(
					`/resin/device_service_environment_variable?$filter=belongs_to__device eq ${device}`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.length(1);
					expect(res.body.d[0])
						.to.have.property('name')
						.equal('test_1');
					expect(res.body.d[0])
						.to.have.property('value')
						.equal('hotdogs');

					return res.body.d[0].id as number;
				});

			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.delete(`/resin/device_service_environment_variable(${varId})`)
					.expect(200);
			});
		});
	});
});

describe('Config Variables', () => {
	let admin = '',
		device = -1,
		deviceUuid = '',
		application = -1;

	const deviceType = 'intel-nuc';

	before(async () => {
		admin = await asAdmin(app);

		application = (await models.createApplication(app, admin, {
			app_name: 'test-06-config-vars',
			application_type: 0,
			device_type: deviceType,
		})).body.id as number;

		const { id, uuid } = (await models.createDevice(app, admin, {
			belongs_to__application: application,
			device_type: deviceType,
		})).body;
		device = id;
		deviceUuid = uuid;
	});

	after(async () => {
		await supertest(app, admin)
			.delete(`/resin/application(${application})`)
			.expect(200);
	});

	describe('Application Config Variables', () => {
		it('should have no application config variables by default', async () => {
			await supertest(app, admin)
				.get(
					`/resin/application_config_variable?$filter=application eq ${application}`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(0);
				});
		});

		it('should create an application config variable for the application', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.post('/resin/application_config_variable')
					.send({
						name: 'BALENA_app_conf_var_1',
						value: 'abcde',
						application,
					})
					.expect(201);
			});

			await supertest(app, admin)
				.get(
					`/resin/application_config_variable?$filter=application eq ${application}&$expand=application`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property(
						'name',
						'BALENA_app_conf_var_1',
					);
					expect(res.body.d[0]).to.have.property('value', 'abcde');
					expect(res.body.d[0])
						.to.have.property('application')
						.that.is.an('array');
					expect(res.body.d[0].application).to.have.lengthOf(1);
					expect(res.body.d[0].application[0]).to.have.property(
						'id',
						application,
					);
				});
		});

		it('should update an application config variable for the application', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.patch(
						`/resin/application_config_variable?$filter=application eq ${application}`,
					)
					.send({
						value: 'vwxyz',
					})
					.expect(200);
			});

			await supertest(app, admin)
				.get(
					`/resin/application_config_variable?$filter=application eq ${application}`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property(
						'name',
						'BALENA_app_conf_var_1',
					);
					expect(res.body.d[0]).to.have.property('value', 'vwxyz');
				});
		});
	});

	describe('Device Config Variables', () => {
		it('should have no device config variables by default', async () => {
			await supertest(app, admin)
				.get(`/resin/device_config_variable?$filter=device eq ${device}`)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(0);
				});
		});

		it('should create a device config variable for the device', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.post('/resin/device_config_variable')
					.send({
						name: 'BALENA_device_conf_var_1',
						value: 'abcde',
						device,
					})
					.expect(201);
			});

			await supertest(app, admin)
				.get(
					`/resin/device_config_variable?$filter=device eq ${device}&$expand=device`,
				)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property(
						'name',
						'BALENA_device_conf_var_1',
					);
					expect(res.body.d[0]).to.have.property('value', 'abcde');
					expect(res.body.d[0])
						.to.have.property('device')
						.that.is.an('array');
					expect(res.body.d[0].device).to.have.lengthOf(1);
					expect(res.body.d[0].device[0]).to.have.property('id', device);
				});
		});

		it('should update a device config variable for the device', async () => {
			await connectDeviceAndWaitForUpdate(deviceUuid, async () => {
				await supertest(app, admin)
					.patch(`/resin/device_config_variable?$filter=device eq ${device}`)
					.send({
						value: 'vwxyz',
					})
					.expect(200);
			});

			await supertest(app, admin)
				.get(`/resin/device_config_variable?$filter=device eq ${device}`)
				.expect(200)
				.then(res => {
					expect(res.body)
						.to.have.property('d')
						.that.is.an('array');
					expect(res.body.d).to.have.lengthOf(1);
					expect(res.body.d[0]).to.have.property(
						'name',
						'BALENA_device_conf_var_1',
					);
					expect(res.body.d[0]).to.have.property('value', 'vwxyz');
				});
		});
	});
});
