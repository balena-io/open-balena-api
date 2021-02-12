import * as mockery from 'mockery';
import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import * as fakeDevice from './test-lib/fake-device';

import * as configMock from '../src/lib/config';
import { UserObjectParam } from './test-lib/supertest';
import { supertest } from './test-lib/supertest';
import _ = require('lodash');

function setSystemAppsValue(value: string[] = []) {
	(configMock as AnyObject)['EXTRA_CONTAINERS'] = value;
}

describe('Extra Containers', function () {
	describe('Device State v2', () => {
		let fx: fixtures.Fixtures;
		let admin: UserObjectParam;
		let applicationId: number;
		let systemAppUuid: string;
		let systemAppServiceId: number;
		let supervisorAppUuid: string;
		let device: fakeDevice.Device;
		let supervisorRelease1: number;
		let supervisorRelease2: number;
		let supervisorReleaseBadArch: number;
		let serviceInstallId: number;

		before(async () => {
			mockery.registerMock('../src/lib/config', configMock);
			fx = await fixtures.load('15-system-apps');

			admin = fx.users.admin;
			applicationId = fx.applications.app1.id;

			systemAppUuid = fx.applications.systemApp1.uuid;
			supervisorAppUuid = fx.applications.supervisorApp.uuid;
			systemAppServiceId = fx.services.service2.id;

			supervisorRelease1 = fx.releases.supervisorRelease1.id;
			supervisorRelease2 = fx.releases.supervisorRelease2.id;
			supervisorReleaseBadArch = fx.releases.supervisorReleasePi.id;

			// create a new device in this test application...
			device = await fakeDevice.provisionDevice(admin, applicationId);

			const { body } = await supertest(admin)
				.get(`/resin/service_install?$filter=device eq ${device.id}`)
				.expect(200);

			const [si] = body.d;
			serviceInstallId = si?.id ?? 0;
		});

		after(async () => {
			await fixtures.clean({ devices: [device] });
			await fixtures.clean(fx);
			mockery.deregisterMock('../src/lib/config');
		});

		it('should inherit environment variables correctly', async () => {
			const checkVar = async (value: string) => {
				const state = await device.getState();
				expect(
					state.local.apps[`${applicationId}`].services[
						`${fx.services.service1.id}`
					].environment['ENV_VAR'],
				).to.equal(value);
			};

			await supertest(admin)
				.post('/resin/application_environment_variable')
				.send({
					application: applicationId,
					name: 'ENV_VAR',
					value: 'app_env_var',
				})
				.expect(201);
			await checkVar('app_env_var');

			await supertest(admin)
				.post('/resin/service_environment_variable')
				.send({
					service: fx.services.service1.id,
					name: 'ENV_VAR',
					value: 'srv_env_var',
				})
				.expect(201);
			await checkVar('srv_env_var');

			await supertest(admin)
				.post('/resin/device_environment_variable')
				.send({
					device: device.id,
					name: 'ENV_VAR',
					value: 'dev_env_var',
				})
				.expect(201);
			await checkVar('dev_env_var');

			await supertest(admin)
				.post('/resin/device_service_environment_variable')
				.send({
					service_install: serviceInstallId,
					name: 'ENV_VAR',
					value: 'si_env_var',
				})
				.expect(201);
			await checkVar('si_env_var');
		});

		it('should have no extra containers by default', async () => {
			setSystemAppsValue();
			expect(configMock.EXTRA_CONTAINERS).to.be.an('array').with.lengthOf(0);

			const state = await device.getState();
			expect(state.local.extraContainers).to.be.undefined;

			expect(state.local.apps).to.have.property(`${applicationId}`);
			expect(state.local.apps[`${applicationId}`]).to.have.property('services');
			expect(state.local.apps[`${applicationId}`]).to.have.property('volumes');
			expect(state.local.apps[`${applicationId}`]).to.have.property('networks');
		});

		it('should have no extra containers if the supervisor version is not set', async () => {
			setSystemAppsValue([
				'f3ad5e4c8309404b834b1dbae41fa6fc',
				'031f48d8f47b4062ad2d67b8de933711',
			]);
			expect(configMock.EXTRA_CONTAINERS).to.be.an('array').with.lengthOf(2);

			const state = await device.getState();
			expect(state.local.extraContainers).to.be.undefined;
		});

		it('should have a single supervised extra container, alongside supervisor container', async () => {
			setSystemAppsValue([systemAppUuid, '031f48d8f47b4062ad2d67b8de933711']);
			expect(configMock.EXTRA_CONTAINERS).to.be.an('array').with.lengthOf(2);

			await supertest(device)
				.patch(`/resin/device(${device.id})`)
				.send({
					should_be_managed_by__release: supervisorRelease1,
				})
				.expect(200);

			const state = await device.getState();

			// should have some extra containers...
			expect(state.local.extraContainers, 'extraContainers is undefined').to.not
				.be.undefined;
			expect(
				state.local.extraContainers,
				'extraContainers has the wrong number of apps',
			).to.not.be.empty;
			expect(
				Object.getOwnPropertyNames(state.local.extraContainers),
			).to.have.lengthOf(2);

			// should have a specific supervised app...
			const systemApp1 = state.local.extraContainers?.[`${systemAppUuid}`];
			expect(systemApp1).to.have.property('services').which.is.not.empty;
			expect(systemApp1).to.have.property('type').which.is.equal('supervised');

			// should have some environment variables...
			const systemAppService1 = systemApp1?.services[`${systemAppServiceId}`];
			expect(systemAppService1).to.have.property('environment').which.is.not
				.empty;

			// should have specific environment variables...
			expect(systemAppService1?.environment)
				.to.have.property('CERT_DOMAIN')
				.equals('my-network.com');
			expect(systemAppService1?.environment)
				.to.have.property('EXTRA_FLAGS')
				.equals('-a -b -c');
		});

		it('should have a single supervisor extra container', async () => {
			setSystemAppsValue([
				supervisorAppUuid,
				'031f48d8f47b4062ad2d67b8de933711',
			]);
			expect(configMock.EXTRA_CONTAINERS).to.be.an('array').with.lengthOf(2);

			await supertest(device)
				.patch(`/resin/device(${device.id})`)
				.send({
					should_be_managed_by__release: supervisorRelease1,
				})
				.expect(200);

			// set our second release as completed so it's updated as latest
			await supertest(admin)
				.patch(`/resin/release(${supervisorRelease2})`)
				.send({
					status: 'success',
				})
				.expect(200);

			const state = await device.getState();

			// should have some extra containers...
			expect(state.local.extraContainers, 'extraContainers is undefined').to.not
				.be.undefined;
			expect(
				state.local.extraContainers,
				'extraContainers has the wrong number of apps',
			).to.not.be.empty;
			expect(
				Object.getOwnPropertyNames(state.local.extraContainers),
			).to.have.lengthOf(1);

			// we need to ensure non-latest supervisors are still returned
			expect(supervisorRelease1).to.equal(
				state.local.extraContainers?.[`${supervisorAppUuid}`].releaseId,
			);
		});

		it('should create image installs when PATCHing the state endpoint, for extra containers', async () => {
			setSystemAppsValue([systemAppUuid]);
			await supertest(device)
				.patch(`/resin/device(${device.id})`)
				.send({
					should_be_managed_by__release: supervisorRelease1,
				})
				.expect(200);

			/**
			 * Sanity check to make sure the system app is provided to the device, prior to PATCHing it...
			 */
			const state = await device.getStateByUuid();
			expect(state.local.apps).to.have.property(systemAppUuid).which.is.not
				.empty;

			const systemAppState = state.local.apps[systemAppUuid];
			const services = _.fromPairs(
				Object.getOwnPropertyNames(systemAppState.services).map((serviceId) => {
					return [
						serviceId,
						{
							status: 'Running',
							releaseId: systemAppState.releaseId,
							download_progress: null,
						},
					];
				}),
			);

			/**
			 * This is the patch body to create image install records...
			 */
			const patchBody = {
				local: {
					apps: {
						[systemAppState.appId]: {
							uuid: systemAppState.uuid,
							services,
						},
					},
				},
			};

			await device.patchStateV2(patchBody);
		});

		it('should merge into apps', async () => {
			setSystemAppsValue([
				'f3ad5e4c8309404b834b1dbae41fa6fc',
				'031f48d8f47b4062ad2d67b8de933711',
			]);
			expect(configMock.EXTRA_CONTAINERS).to.be.an('array').with.lengthOf(2);

			const state = await device.getStateByUuid();

			// should have merge the extra containers into the apps...
			expect(state.local).to.not.have.property('extraContainers');

			// should have a specific supervised app...
			const systemApp1 = state.local.apps?.[`${systemAppUuid}`];
			expect(systemApp1).to.have.property('services').which.is.not.empty;
			expect(systemApp1).to.have.property('type').which.is.equal('supervised');

			// should have some environment variables...
			const systemAppService1 = systemApp1?.services[`${systemAppServiceId}`];
			expect(systemAppService1).to.have.property('environment').which.is.not
				.empty;

			// should have specific environment variables...
			expect(systemAppService1?.environment)
				.to.have.property('CERT_DOMAIN')
				.equals('my-network.com');
			expect(systemAppService1?.environment)
				.to.have.property('EXTRA_FLAGS')
				.equals('-a -b -c');
		});

		it('should not run a supervisor of the wrong arch', async () => {
			await supertest(device)
				.patch(`/resin/device(${device.id})`)
				.send({
					should_be_managed_by__release: supervisorReleaseBadArch,
				})
				.expect(400);
		});
	});
});
