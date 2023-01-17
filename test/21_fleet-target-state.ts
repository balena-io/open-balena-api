import * as _ from 'lodash';
import * as mockery from 'mockery';
import { expect } from 'chai';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import * as configMock from '../src/lib/config';
import * as fixtures from './test-lib/fixtures';
import { Application } from '../src/balena-model';

const POLL_MSEC = 2000;
const TIMEOUT_SEC = 1;

// @ts-expect-error mock the value for the default poll interval...
configMock['DEFAULT_SUPERVISOR_POLL_INTERVAL'] = POLL_MSEC;

// @ts-expect-error mock the value for the timeout grace period...
configMock['API_HEARTBEAT_STATE_TIMEOUT_SECONDS'] = TIMEOUT_SEC;

// register the mocks...
mockery.registerMock('../src/lib/config', configMock);

// test fleet default state helper
const appMatcherFunc = (svc: AnyObject, fxProp: AnyObject) =>
	svc.hasOwnProperty('environment') && !!fxProp;
const svcMatcherFunc = (svc: AnyObject, fxProp: AnyObject) =>
	svc.id === fxProp.service.__id;
const imgMatcherFunc = (svc: AnyObject, fxProp: AnyObject) =>
	svc.image_id === fxProp.release_image.__id;

const checkServiceProperties = (
	fixture: AnyObject,
	fleetStateReleasesServices: AnyObject,
	propertyCollectionName: string,
	propKeyIdentifier: string,
	matcherFunction: (svc: AnyObject, fxProperty: AnyObject) => boolean,
) => {
	for (const fxProperty of Object.values(fixture)) {
		for (const svc of Object.values<any>(fleetStateReleasesServices)) {
			expect(svc).to.haveOwnProperty(propertyCollectionName);
			if (matcherFunction(svc, fxProperty)) {
				expect(svc[propertyCollectionName]).to.include({
					[fxProperty[propKeyIdentifier]]: fxProperty.value,
				});
			} else {
				expect(svc[propertyCollectionName]).to.not.include({
					[fxProperty[propKeyIdentifier]]: fxProperty.value,
				});
			}
		}
	}
};

(['v3'] as const).forEach((stateVersion) =>
	describe(`Fleet State ${stateVersion}`, () => {
		let fx: fixtures.Fixtures;
		let admin: UserObjectParam;
		let application: Application;

		before(async () => {
			fx = await fixtures.load('21-fleet-target-state');
			admin = fx.users.admin;
			application = fx.applications.app1;
		});

		after(async () => {
			await fixtures.clean(fx);
			// mockery.deregisterMock('../src/lib/env-vars');
			mockery.deregisterMock('../src/lib/config');
			// mockery.deregisterMock('../src/lib/device-online-state');
		});

		it(`Should get device state V3 compatible default fleet states`, async () => {
			[
				`/device/${stateVersion}/fleet/${application.uuid}/state`,
				`/device/${stateVersion}/fleet/${application.uuid}/release/${fx.releases.release2.commit}/state`,
			].forEach((fleetStateEndpoint) => {
				describe(`Should get ${fleetStateEndpoint} and check schema and properties`, async () => {
					const fleetRes = await supertest(admin)
						.get(fleetStateEndpoint)
						.expect(200);

					expect(fleetRes.body).to.be.not.empty;
					const fleetDefaultState = fleetRes.body;

					expect(fleetDefaultState)
						.to.be.an('object')
						.that.haveOwnProperty(application.uuid);

					expect(fleetDefaultState[application.uuid]).to.haveOwnProperty(
						'apps',
					);
					const fleetApps = fleetDefaultState[application.uuid].apps;

					expect(fleetApps).to.haveOwnProperty(application.uuid);
					expect(fleetApps[application.uuid]).to.haveOwnProperty('releases');
					const fleetStateReleases = fleetApps[application.uuid].releases;

					expect(fleetStateReleases).to.haveOwnProperty(
						fx.releases.release1.commit,
					);
					expect(
						fleetStateReleases[fx.releases.release1.commit],
					).to.haveOwnProperty('services');
					const fleetStateReleasesServices =
						fleetStateReleases[fx.releases.release1.commit].services;

					expect(fleetStateReleasesServices).to.include.all.keys(
						Object.keys(fx.services),
					);

					// check app environment to apply to all services inside an app
					checkServiceProperties(
						fx.application_environment_variables,
						fleetStateReleasesServices,
						'environment',
						'name',
						appMatcherFunc,
					);
					// check service environment to apply to only specified services
					checkServiceProperties(
						fx.service_environment_variables,
						fleetStateReleasesServices,
						'environment',
						'name',
						svcMatcherFunc,
					);
					// check service labels to apply to only specified services
					checkServiceProperties(
						fx.service_labels,
						fleetStateReleasesServices,
						'labels',
						'label_name',
						svcMatcherFunc,
					);
					// check image environment variables to apply to only specified services
					checkServiceProperties(
						fx.image_environment_variables,
						fleetStateReleasesServices,
						'environment',
						'name',
						imgMatcherFunc,
					);
					// check image labels to apply to only specified images
					checkServiceProperties(
						fx.image_labels,
						fleetStateReleasesServices,
						'labels',
						'label_name',
						imgMatcherFunc,
					);

					// check that fleet config contains all fleet config variables independent of apps/services
					expect(fleetDefaultState[application.uuid]).to.haveOwnProperty(
						'config',
					);
					const fleetConfig = fleetDefaultState[application.uuid].config;

					for (const appConfVar of Object.values(
						fx.application_config_variables,
					)) {
						expect(fleetConfig).to.include({
							[appConfVar.name]: appConfVar.value,
						});
					}
				});
			});
		});

		describe('Fleet Default State - Poll Interval Acquisition', () => {
			it('Should see default value when not overridden', async () => {
				const fleetState = await supertest(admin)
					.get(`/device/${stateVersion}/fleet/${application.uuid}/state`)
					.expect(200);
				expect(fleetState.body)
					.to.haveOwnProperty(application.uuid)
					.to.haveOwnProperty('config')
					.to.haveOwnProperty('RESIN_SUPERVISOR_POLL_INTERVAL')
					.to.equal(POLL_MSEC.toString());
			});

			it('Should see the application-specific value if one exists', async () => {
				await supertest(admin)
					.post(`/${version}/application_config_variable`)
					.send({
						name: 'RESIN_SUPERVISOR_POLL_INTERVAL',
						value: '123000',
						application: application.id,
					})
					.expect(201);

				const fleetState = await supertest(admin)
					.get(`/device/${stateVersion}/fleet/${application.uuid}/state`)
					.expect(200);

				expect(fleetState.body)
					.to.haveOwnProperty(application.uuid)
					.to.haveOwnProperty('config')
					.to.haveOwnProperty('RESIN_SUPERVISOR_POLL_INTERVAL')
					.to.equal('123000');
			});

			it('Should see the default value if the application-specific value is less than it', async () => {
				await supertest(admin)
					.patch(
						`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${application.id}`,
					)
					.send({
						value: `${POLL_MSEC - 200}`,
					})
					.expect(200);

				const fleetState = await supertest(admin)
					.get(`/device/${stateVersion}/fleet/${application.uuid}/state`)
					.expect(200);

				expect(fleetState.body)
					.to.haveOwnProperty(application.uuid)
					.to.haveOwnProperty('config')
					.to.haveOwnProperty('RESIN_SUPERVISOR_POLL_INTERVAL')
					.to.equal(POLL_MSEC.toString());

				await supertest(admin)
					.delete(
						`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${application.id}`,
					)
					.expect(200);
			});
		});
	}),
);
