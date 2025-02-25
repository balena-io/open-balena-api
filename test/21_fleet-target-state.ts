import { expect } from 'chai';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as config from '@balena/open-balena-api/config';
import * as fixtures from './test-lib/fixtures.js';
import type { Application } from '@balena/open-balena-api/models/balena-model.d.ts';

const version = 'resin';
const POLL_MSEC = 2000;
const TIMEOUT_SEC = 1;

config.TEST_MOCK_ONLY.DEFAULT_SUPERVISOR_POLL_INTERVAL = POLL_MSEC;
config.TEST_MOCK_ONLY.API_HEARTBEAT_STATE_TIMEOUT_SECONDS = TIMEOUT_SEC;

// test fleet default state helper
const appMatcherFunc = (svc: AnyObject, fxProp: AnyObject) =>
	Object.hasOwn(svc, 'environment') && !!fxProp;
const svcMatcherFunc = (svc: AnyObject, fxProp: AnyObject) =>
	svc.id === fxProp.service.__id;
const imgMatcherFunc = (svc: AnyObject, fxProp: AnyObject) =>
	svc.image_id === fxProp.release_image.image.__id;

const checkServiceProperties = (
	fixture: AnyObject,
	fleetStateReleasesServices: AnyObject,
	propertyCollectionName: string,
	propKeyIdentifier: string,
	matcherFunction: (svc: AnyObject, fxProperty: AnyObject) => boolean,
) => {
	for (const fxProperty of Object.values(fixture)) {
		for (const svc of Object.values(fleetStateReleasesServices)) {
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

export default () => {
	(['v3'] as const).forEach((stateVersion) =>
		describe(`Fleet State ${stateVersion}`, function () {
			let fx: fixtures.Fixtures;
			let application: Application['Read'];
			let admin: UserObjectParam;
			let releases: AnyObject;
			let fleetStateEndpoint: string;

			before(async function () {
				fx = await fixtures.load('21-fleet-target-state');
				admin = fx.users.admin;
				application = fx.applications.app1;
				releases = fx.releases;
				fleetStateEndpoint = `/device/${stateVersion}/fleet/${application.uuid}/state`;
			});

			after(async function () {
				await fixtures.clean(fx);
			});

			describe(`Default State`, function () {
				it(`Should get fleet default state endpoint`, async function () {
					await supertest(admin).get(fleetStateEndpoint).expect(200);
				});

				it(`should fail to get a state for an unknown fleetUuid `, async () => {
					await supertest(admin)
						.get(`/device/${stateVersion}/fleet/AABBAABAA/state`)
						.expect(401);
				});

				it(`should fail to get a state for an unknown releaseUuid parameter`, async () => {
					await supertest(admin)
						.get(`${fleetStateEndpoint}?releaseUuid=AABBAABB`)
						.expect(401);
				});

				(
					[
						'default', // fleet default
						'release1',
						'release2',
					] as const
				).forEach((testReleaseKey) => {
					it(`with releaseUuid parameter for ${testReleaseKey}`, async () => {
						const releaseUuidQueryParam = releases[testReleaseKey]?.commit
							? `?releaseUuid=${releases[testReleaseKey]?.commit}`
							: '';
						const fleetRes = await supertest(admin)
							.get(`${fleetStateEndpoint}${releaseUuidQueryParam}`)
							.expect(200);

						const release = releases[testReleaseKey] ?? releases.release1;
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

						expect(fleetStateReleases).to.haveOwnProperty(release.commit);
						expect(fleetStateReleases[release.commit]).to.haveOwnProperty(
							'services',
						);
						const fleetStateReleasesServices =
							fleetStateReleases[release.commit].services;

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

			describe('Fleet Default State - Poll Interval Acquisition', function () {
				it('Should see default value when not overridden', async function () {
					const fleetState = await supertest(admin)
						.get(fleetStateEndpoint)
						.expect(200);
					expect(fleetState.body)
						.to.haveOwnProperty(application.uuid)
						.to.haveOwnProperty('config')
						.to.haveOwnProperty('RESIN_SUPERVISOR_POLL_INTERVAL')
						.to.equal(POLL_MSEC.toString());
				});

				it('Should see the application-specific value if one exists', async function () {
					await supertest(admin)
						.post(`/${version}/application_config_variable`)
						.send({
							name: 'RESIN_SUPERVISOR_POLL_INTERVAL',
							value: '123000',
							application: application.id,
						})
						.expect(201);

					const fleetState = await supertest(admin)
						.get(fleetStateEndpoint)
						.expect(200);

					expect(fleetState.body)
						.to.haveOwnProperty(application.uuid)
						.to.haveOwnProperty('config')
						.to.haveOwnProperty('RESIN_SUPERVISOR_POLL_INTERVAL')
						.to.equal('123000');
				});

				it('Should see the default value if the application-specific value is less than it', async function () {
					await supertest(admin)
						.patch(
							`/${version}/application_config_variable?$filter=name eq 'RESIN_SUPERVISOR_POLL_INTERVAL' and application eq ${application.id}`,
						)
						.send({
							value: `${POLL_MSEC - 200}`,
						})
						.expect(200);

					const fleetState = await supertest(admin)
						.get(fleetStateEndpoint)
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
};
