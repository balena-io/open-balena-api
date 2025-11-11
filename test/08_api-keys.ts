import { VPN_SERVICE_API_KEY } from '../src/lib/config.js';
import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import { generateDeviceUuid } from './test-lib/fake-device.js';
import type { UserObjectParam } from './test-lib/supertest.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import { sbvrUtils, permissions } from '@balena/pinejs';
import { expectResourceToMatch } from './test-lib/api-helpers.js';
import { assertExists } from './test-lib/common.js';
import { loginUserSudoTimeoutAgo } from './test-lib/users.js';
import type { ApiKey } from '../src/balena-model.js';

const { api } = sbvrUtils;

export default () => {
	versions.test((version, pineTest) => {
		describe('create provisioning apikey', function () {
			before(async function () {
				const fx = await fixtures.load('08-create-device-apikey');
				this.loadedFixtures = fx;
				this.user = fx.users.admin;
				this.application = fx.applications.app1;
				this.secondApplication = fx.applications.app2;
			});

			after(async function () {
				await supertest(this.user).delete(`/${version}/api_key`).expect(200);
				await fixtures.clean(this.loadedFixtures);
			});

			[
				{
					title: `using /api-key/application/:appId/provisioning endpoint`,
					fn(
						user: UserObjectParam | undefined,
						applicationId: number,
						provisioningKeyName?: string,
						provisioningKeyDescription?: string,
						provisioningKeyExpiryDate?: string,
					) {
						return supertest(user)
							.post(`/api-key/application/${applicationId}/provisioning`)
							.send({
								name: provisioningKeyName,
								description: provisioningKeyDescription,
								expiryDate: provisioningKeyExpiryDate,
							});
					},
				},
				{
					title: 'using the /api-key/v1/ endpoint',
					fn(
						user: UserObjectParam | undefined,
						applicationId: number,
						provisioningKeyName?: string,
						provisioningKeyDescription?: string,
						provisioningKeyExpiryDate?: string,
					) {
						return supertest(user)
							.post(`/api-key/v1/`)
							.send({
								actorType: 'application',
								actorTypeId: applicationId,
								roles: ['provisioning-api-key'],
								name: provisioningKeyName,
								description: provisioningKeyDescription,
								expiryDate: provisioningKeyExpiryDate,
							});
					},
				},
			].forEach(({ title, fn }) => {
				describe(title, function () {
					const uuid =
						'f716a3e020bd444b885cb394453917520c3cf82e69654f84be0d33e31a0e15';

					after(async function () {
						await supertest(this.user)
							.delete(`/${version}/device?$filter=uuid eq '${uuid}'`)
							.expect(200);
					});

					it('should not allow unauthorized requests', async function () {
						await fn(undefined, this.application.id).expect(401);
					});

					it('should be able to create a provisioning key', async function () {
						const applicationId = this.application.id;
						const { body: provisioningKey } = await fn(
							this.user,
							applicationId,
							`provision-key-${applicationId}`,
							`Sample key for application-${applicationId} description.`,
						).expect(200);

						expect(provisioningKey).to.be.a('string');
						this.provisioningKey = provisioningKey;

						// check the name assigned
						const apiKeyResp = await api.resin.get({
							resource: 'api_key',
							passthrough: {
								req: permissions.root,
							},
							id: {
								key: provisioningKey,
							},
							options: {
								$select: ['name', 'description'],
							},
						});

						expect(apiKeyResp).to.have.property(
							'name',
							`provision-key-${applicationId}`,
						);
						expect(apiKeyResp).to.have.property(
							'description',
							`Sample key for application-${applicationId} description.`,
						);
					});

					it('should be able to create a provisioning key when using a non-sudo token', async function () {
						const userWithNonSudoToken = await loginUserSudoTimeoutAgo(
							this.user.id,
						);
						const applicationId = this.application.id;
						const { body: provisioningKey } = await fn(
							userWithNonSudoToken,
							applicationId,
							`provision-key-from-non-sudo-jwt-${applicationId}`,
							`Sample key for application-${applicationId} description.`,
						).expect(200);

						expect(provisioningKey).to.be.a('string');
					});

					it('should be able to create a provisioning key with a valid expiry date', async function () {
						const applicationId = this.application.id;
						const tomorrowDate = new Date(Date.now() + 86400000); // one day in future
						const { body: provisioningKey } = await fn(
							this.user,
							applicationId,
							`provision-key-${applicationId}-with-expiry`,
							`Sample key for application-${applicationId} description.`,
							tomorrowDate.toISOString(),
						).expect(200);

						expect(provisioningKey).to.be.a('string');
						this.provisioningKey = provisioningKey;

						// check the name assigned
						const apiKeyResp = await api.resin.get({
							resource: 'api_key',
							passthrough: {
								req: permissions.root,
							},
							id: {
								key: provisioningKey,
							},
							options: {
								$select: ['name', 'description', 'expiry_date'],
							},
						});

						assertExists(apiKeyResp);
						expect(apiKeyResp).to.have.property(
							'name',
							`provision-key-${applicationId}-with-expiry`,
						);
						expect(apiKeyResp).to.have.property(
							'description',
							`Sample key for application-${applicationId} description.`,
						);

						assertExists(apiKeyResp.expiry_date);
						const expiryDate = new Date(apiKeyResp.expiry_date);
						expect(expiryDate.getTime()).to.equal(tomorrowDate.getTime());
					});

					it('should not be able to create a provisioning key with a in-valid expiry date', async function () {
						const applicationId = this.application.id;
						const invalidDate = 'INVALID_DATE';
						await fn(
							this.user,
							applicationId,
							`provision-key-${applicationId}-with-expiry`,
							`Sample key for application-${applicationId} description.`,
							invalidDate,
						).expect(400, '"Key expiry date should be a valid date"');
					});

					it('should not be able to register a device with an expired provisioning key', async function () {
						const applicationId = this.application.id;
						const yesterdayDate = new Date(Date.now() - 86400000); // one day in past
						const { body: provisioningKey } = await fn(
							this.user,
							applicationId,
							`provision-key-${applicationId}-expired`,
							`Sample key for application-${applicationId} description.`,
							yesterdayDate.toISOString(),
						).expect(200);

						expect(provisioningKey).to.be.a('string');

						await supertest()
							.post(`/device/register?apikey=${provisioningKey}`)
							.send({
								user: this.user.id,
								application: this.application.id,
								device_type: 'raspberry-pi',
								uuid,
							})
							.expect(401);
					});

					it('then register a device using the provisioning key', async function () {
						const { body: device } = await supertest()
							.post(`/device/register?apikey=${this.provisioningKey}`)
							.send({
								user: this.user.id,
								application: this.application.id,
								device_type: 'raspberry-pi',
								uuid,
							})
							.expect(201);

						expect(device).to.have.property('id').that.is.a('number');
						expect(device).to.have.property('uuid', uuid);
						expect(device).to.have.property('api_key').that.is.a('string');
					});

					it('should be able to register a device after updating the expiry date for provisioning key', async function () {
						const applicationId = this.secondApplication.id;
						const yesterdayDate = new Date(Date.now() - 86400000); // one day in past
						const { body: provisioningKey } = await fn(
							this.user,
							applicationId,
							`provision-key-${applicationId}-expired`,
							`Sample key for application-${applicationId} description.`,
							yesterdayDate.toISOString(),
						).expect(200);

						expect(provisioningKey).to.be.a('string');

						// patch existing key with a future expiry date
						const tomorrowDate = new Date(Date.now() + 86400000); // one day in future
						await api.resin.patch({
							resource: 'api_key',
							passthrough: {
								req: permissions.root,
							},
							id: {
								key: provisioningKey,
							},
							body: {
								expiry_date: tomorrowDate,
							},
						});

						await supertest()
							.post(`/device/register?apikey=${provisioningKey}`)
							.send({
								user: this.user.id,
								application: applicationId,
								device_type: 'intel-nuc',
								uuid: generateDeviceUuid(),
							})
							.expect(201);
					});
				});
			});
		});

		describe('create device apikey', function () {
			before(async function () {
				const fx = await fixtures.load('08-create-device-apikey');
				this.loadedFixtures = fx;
				this.user = fx.users.admin;
				this.application = fx.applications.app1;
				this.device = fx.devices.device1;
			});

			after(async function () {
				await supertest(this.user).delete(`/${version}/api_key`).expect(200);
				await fixtures.clean(this.loadedFixtures);
			});

			[
				{
					title: 'using the /api-key/device/deviceId/device-key endpoint',
					fn(
						user: UserObjectParam | undefined,
						deviceId: number,
						body?: AnyObject,
					) {
						return supertest(user)
							.post(`/api-key/device/${deviceId}/device-key`)
							.send(body);
					},
				},
				{
					title: 'using the /api-key/v1/ endpoint',
					fn(
						user: UserObjectParam | undefined,
						deviceId: number,
						body?: AnyObject,
					) {
						return supertest(user)
							.post(`/api-key/v1/`)
							.send({
								actorType: 'device',
								actorTypeId: deviceId,
								roles: ['device-api-key'],
								...body,
							});
					},
				},
			].forEach(({ title, fn }, i) => {
				describe(title, function () {
					it('should create an apikey when no property is set in the body', async function () {
						const { body: apiKey } = await fn(
							this.user,
							this.device.id,
							{},
						).expect(200);

						expect(apiKey).to.be.a('string');
						expect(apiKey).to.not.be.empty;
					});

					it('should create an apikey with the value passed in the body', async function () {
						const apiKey = `bananas-${version}-${i}`;
						const { body: deviceApiKey } = await fn(this.user, this.device.id, {
							apiKey,
						}).expect(200);

						expect(deviceApiKey).to.be.a('string');
						expect(deviceApiKey).to.equal(apiKey);
					});

					it('should be able to create an apikey when using a non-sudo token', async function () {
						const userWithNonSudoToken = await loginUserSudoTimeoutAgo(
							this.user.id,
						);
						const apiKey = `bananas-from-non-sudo-jwt-${version}-${i}`;
						const { body: deviceApiKey } = await fn(
							userWithNonSudoToken,
							this.device.id,
							{
								apiKey,
							},
						).expect(200);

						expect(deviceApiKey).to.be.a('string');
						expect(deviceApiKey).to.equal(apiKey);
					});

					it('should create an apikey with only the key-name passed in the body', async function () {
						const { body: deviceApiKey } = await fn(this.user, this.device.id, {
							name: `SampleDeviceKey${i}`,
						}).expect(200);

						expect(deviceApiKey).to.be.a('string');
						expect(deviceApiKey).to.not.be.empty;

						// check the name:description assigned
						const apiKeyResp = await api.resin.get({
							resource: 'api_key',
							passthrough: {
								req: permissions.root,
							},
							id: {
								key: deviceApiKey,
							},
							options: {
								$select: ['name'],
							},
						});

						expect(apiKeyResp).to.have.property('name', `SampleDeviceKey${i}`);
					});

					it('should create an apikey with the key-name and key-description passed in the body', async function () {
						const { body: deviceApiKey } = await fn(this.user, this.device.id, {
							name: `SampleDeviceKey${i}`,
							description: `Sample key ${i} description.`,
						}).expect(200);

						expect(deviceApiKey).to.be.a('string');
						expect(deviceApiKey).to.not.be.empty;

						// check the name:description assigned
						const apiKeyResp = await api.resin.get({
							resource: 'api_key',
							passthrough: {
								req: permissions.root,
							},
							id: {
								key: deviceApiKey,
							},
							options: {
								$select: ['name', 'description'],
							},
						});

						expect(apiKeyResp).to.have.property('name', `SampleDeviceKey${i}`);
						expect(apiKeyResp).to.have.property(
							'description',
							`Sample key ${i} description.`,
						);
					});

					it('should return BadRequest for an apikey create request where the key name is not string', async function () {
						await fn(this.user, this.device.id, {
							name: 123,
						}).expect(400, '"Key name should be a string value"');
					});

					it('should not allow unauthorized requests', async function () {
						await fn(undefined, this.device.id).expect(401);
					});
				});
			});
		});

		describe('create named user apikey', function () {
			let userIdForUnauthorizedRequest = 0;
			let pineUser: typeof pineTest;

			before(async function () {
				const fx = await fixtures.load();
				this.loadedFixtures = fx;
				this.user = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: {
						user: this.user,
					},
				});
				userIdForUnauthorizedRequest = this.user.id;
			});
			after(async function () {
				await supertest(this.user).delete(`/${version}/api_key`).expect(200);
				await fixtures.clean(this.loadedFixtures);
			});

			[
				{
					title: 'using the /api-key/user/full endpoint',
					missingNameErrorMessage: '"API keys require a name"',
					fn(user: UserObjectParam | undefined, body?: AnyObject) {
						return supertest(user).post(`/api-key/user/full`).send(body);
					},
				},
				{
					title: 'using the /api-key/v1/ endpoint',
					missingNameErrorMessage: `"API keys with the 'named-user-api-key' role require a name"`,
					fn(user: UserObjectParam | undefined, body?: AnyObject) {
						return supertest(user)
							.post(`/api-key/v1/`)
							.send({
								actorType: 'user',
								actorTypeId: user?.id ?? userIdForUnauthorizedRequest,
								roles: ['named-user-api-key'],
								...body,
							});
					},
				},
			].forEach(({ title, fn, missingNameErrorMessage }) => {
				describe(title, function () {
					it('should not allow unauthorized requests', async () => {
						await fn(undefined, undefined).expect(401);
					});

					it('should not allow requests without name', async function () {
						await fn(this.user, {}).expect(400, missingNameErrorMessage);
					});

					it('should not allow requests with an empty name', async function () {
						await fn(this.user, { name: '' }).expect(
							400,
							missingNameErrorMessage,
						);
					});

					it('should not allow requests with a non-sudo token', async function () {
						const userWithNonSudoToken = await loginUserSudoTimeoutAgo(
							this.user.id,
						);
						await fn(userWithNonSudoToken, {
							name: 'some-name',
						}).expect(401, '"Fresh authentication token required"');
					});

					it('should allow api keys without description', async function () {
						const { body: apiKey } = await fn(this.user, {
							name: 'some-name',
						}).expect(200);

						expect(apiKey).to.be.a('string');
						expect(apiKey).to.not.be.empty;
					});

					it('should allow api keys with description', async function () {
						const { body: apiKey } = await fn(this.user, {
							name: 'other-name',
							description: 'a description',
						}).expect(200);

						expect(apiKey).to.be.a('string');
						expect(apiKey).to.not.be.empty;
					});

					it('should not allow requests with a name longer than 50 characters', async function () {
						const name = 'too-long-name-'.padEnd(51, 'a');
						const description = 'too long name test description';
						await fn(this.user, { name, description }).expect(
							400,
							'"It is necessary that each api key that has a name, has a name that has a Length (Type) that is less than or equal to 50."',
						);
					});

					it('should not allow requests with a description longer than 150 characters', async function () {
						const name = 'too-long-description-test-name';
						const description = 'too long description '.padEnd(151, 'a');
						await fn(this.user, { name, description }).expect(
							400,
							'"It is necessary that each api key that has a description, has a description that has a Length (Type) that is less than or equal to 150."',
						);
					});

					it('should allow requests with a 50 chars long name & 150 chars long description', async function () {
						const name = 'loooong-name-'.padEnd(50, 'a');
						const description = 'loooong description '.padEnd(150, 'a');
						const { body: apiKey } = await fn(this.user, {
							name,
							description,
						}).expect(200);
						expect(apiKey).to.be.a('string');
						expect(apiKey).to.not.be.empty;
					});
				});
			});

			describe('update named user apikey', function () {
				let testApiKey: Pick<ApiKey['Read'], 'id'>;
				before(async function () {
					const name = 'name-to-update';
					const description = 'description-to-update';
					await supertest(this.user)
						.post(`/api-key/v1/`)
						.send({
							actorType: 'user',
							actorTypeId: this.user.id,
							roles: ['named-user-api-key'],
							name,
							description,
						});

					const {
						body: [apiKey],
					} = await pineUser
						.get({
							resource: 'api_key',
							options: {
								$top: 1,
								$select: 'id',
								$filter: {
									name,
								},
								$orderby: { id: 'desc' },
							},
						})
						.expect(200);
					assertExists(apiKey, 'Api key not found');
					testApiKey = apiKey as Pick<ApiKey['Read'], 'id'>;
				});

				it('should not allow updating the name of an api key to a value longer than 50 characters', async function () {
					const name = 'too-long-name-'.padEnd(51, 'a');
					await pineUser
						.patch({
							resource: 'api_key',
							id: testApiKey.id,
							body: {
								name,
							},
						})
						.expect(
							400,
							'"It is necessary that each api key that has a name, has a name that has a Length (Type) that is less than or equal to 50."',
						);
				});

				it('should not allow updating the description of an api key to a value longer than 150 characters', async function () {
					const description = 'too long description '.padEnd(151, 'a');
					await pineUser
						.patch({
							resource: 'api_key',
							id: testApiKey.id,
							body: {
								description,
							},
						})
						.expect(
							400,
							'"It is necessary that each api key that has a description, has a description that has a Length (Type) that is less than or equal to 150."',
						);
				});

				it('should allow updating an api key to a 50 chars long name & 150 chars long description', async function () {
					const name = 'loooong-name-updated-'.padEnd(50, 'b');
					const description = 'too long description updated '.padEnd(150, 'b');
					await pineUser
						.patch({
							resource: 'api_key',
							id: testApiKey.id,
							body: {
								name,
								description,
							},
						})
						.expect(200);
					await expectResourceToMatch(pineUser, 'api_key', testApiKey.id, {
						name,
						description,
					});
				});
			});
		});

		describe('use api key instead of jwt', function () {
			before(async function () {
				const fx = await fixtures.load();
				this.loadedFixtures = fx;
				this.user = fx.users.admin;
			});

			after(async function () {
				await supertest(this.user).delete(`/${version}/api_key`).expect(200);
				await fixtures.clean(this.loadedFixtures);
			});

			it('should accept api keys on the Authorization header on custom endpoints already expecting only api keys', async function () {
				const { status } = await supertest(VPN_SERVICE_API_KEY).post(
					'/services/vpn/client-connect',
				);

				expect(status).to.not.equal(401);
			});

			const RESTRICTED_ENDPOINTS: Array<{
				method: 'get' | 'post';
				path: string;
				body?: AnyObject;
				status?: number;
			}> = [
				{ method: 'post', path: '/api-key/user/full', body: { name: 'aname' } },
			];

			[
				{
					title: 'when generated using the /api-key/user/full endpoint',
					async beforeFn() {
						const { body: namedApiKey } = await supertest(this.user)
							.post('/api-key/user/full')
							.send({ name: 'named' })
							.expect(200);

						expect(namedApiKey).to.be.a('string');
						this.namedApiKey = namedApiKey;
					},
				},
				{
					title: 'when generated using the /api-key/v1/ endpoint',
					async beforeFn() {
						const { body: namedApiKey } = await supertest(this.user)
							.post(`/api-key/v1/`)
							.send({
								actorType: 'user',
								actorTypeId: this.user.id,
								roles: ['named-user-api-key'],
								name: 'named',
							});

						expect(namedApiKey).to.be.a('string');
						this.namedApiKey = namedApiKey;
					},
				},
			].forEach(({ title, beforeFn }) => {
				describe(title, function () {
					before(beforeFn);

					it('should be able to access an allowed standard endpoint with a named user-level api key', async function () {
						await supertest()
							.get(`/${version}/user(${this.user.id})?$select=username`)
							.query({ apikey: this.namedApiKey })
							.expect(200);
					});

					it('should accept api keys on the Authorization header on standard endpoints', async function () {
						await supertest(this.namedApiKey)
							.get(`/${version}/user(${this.user.id})?$select=username`)
							.expect(200);
					});

					it('should return user info', async function () {
						const { body } = await supertest(this.namedApiKey)
							.get('/user/v1/whoami')
							.expect(200);

						expect(body).to.have.property('id');
						expect(body).to.have.property('username');
						expect(body).to.have.property('email');
					});

					describe('should correctly control access to named user-level api keys', function () {
						RESTRICTED_ENDPOINTS.forEach(({ method, path, body }) => {
							it(`${method} ${path}`, async function () {
								await supertest()
									[method](path)
									.query({ apikey: this.namedApiKey })
									.send(body)
									.expect(401);
							});
						});
					});
				});
			});

			describe('should correctly control access to JWTs', function () {
				RESTRICTED_ENDPOINTS.forEach(({ method, path, body, status = 200 }) => {
					it(`${method} ${path}`, async function () {
						await supertest(this.user)[method](path).send(body).expect(status);
					});
				});
			});
		});

		describe('standard api key endpoints', function () {
			before(async function () {
				const fx = await fixtures.load();

				this.loadedFixtures = fx;
				this.user = fx.users.admin;

				const { body: apikey } = await supertest(this.user)
					.post('/api-key/user/full')
					.send({ name: 'witty' })
					.expect(200);

				expect(apikey).to.be.a('string');
				this.apikey = apikey;
			});
			after(async function () {
				await supertest(this.user).delete(`/${version}/api_key`).expect(200);
				await fixtures.clean(this.loadedFixtures);
			});

			it('should not allow api keys to be created using the standard endpoint', async function () {
				await supertest(this.user)
					.post(`/${version}/api_key`)
					.send({ name: 'witty' })
					.expect(401);
			});

			it('should allow api keys to read api keys', async function () {
				const { body } = await supertest()
					.get(`/${version}/api_key?$select=name`)
					.query({ apikey: this.apikey })
					.expect(200);

				expect(body).to.have.property('d').that.has.length(1);
				expect(body.d[0]).to.have.property('name').that.equals('witty');
			});

			it('should allow users to read api keys', async function () {
				const { body } = await supertest(this.user)
					.get(`/${version}/api_key?$select=id,name`)
					.expect(200);
				expect(body).to.have.property('d').that.has.length(1);
				const [apiKey] = body.d;
				expect(apiKey).to.have.property('id').that.is.a('number');
				expect(apiKey).to.have.property('name').that.equals('witty');
				this.apiKeyId = apiKey.id;
			});

			it('should not allow api keys to update api keys', async function () {
				await supertest()
					.patch(`/${version}/api_key(${this.apiKeyId})`)
					.query({ apikey: this.apikey })
					.send({ name: 'unfunny' })
					.expect(401);
			});

			it('should allow users to update api keys', async function () {
				await supertest(this.user)
					.patch(`/${version}/api_key(${this.apiKeyId})`)
					.send({ name: 'unfunny' })
					.expect(200);

				const { body } = await supertest(this.user)
					.get(`/${version}/api_key?$select=name`)
					.expect(200);
				expect(body).to.have.property('d').that.has.length(1);
				expect(body.d[0]).to.have.property('name').that.equals('unfunny');
			});

			it('should not allow api keys to delete api keys', async function () {
				await supertest()
					.del(`/${version}/api_key(${this.apiKeyId})`)
					.query({ apikey: this.apikey })
					.expect(401);
			});

			it('should allow users to delete api keys', async function () {
				await supertest(this.user)
					.del(`/${version}/api_key(${this.apiKeyId})`)
					.expect(200);

				const { body } = await supertest(this.user)
					.get(`/${version}/api_key?$select=id`)
					.expect(200);

				expect(body).to.have.property('d').that.has.length(0);
			});
		});

		describe('generic-api-key-endpoint', function () {
			for (const apiKeyVersion of ['v1', 'v2'] as const) {
				describe(apiKeyVersion, function () {
					before(async function () {
						const fx = await fixtures.load();
						this.loadedFixtures = fx;
						this.user = fx.users.admin;
					});

					after(async function () {
						await supertest(this.user)
							.delete(`/${version}/api_key`)
							.expect(200);
						await fixtures.clean(this.loadedFixtures);
					});

					const defaultExpiryDate =
						apiKeyVersion === 'v1' ? undefined : new Date().toISOString();

					describe('parameter checks', function () {
						it('should reject unauthorized requests', async function () {
							await supertest()
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(401);
						});

						it('should reject requests for an unsupported actor type', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'organization',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400, '"Unsupported actor type"');
						});

						it('should reject requests when the actor type id is missing', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									roles: ['named-user-api-key'],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400, '"Actor type id must be a number"');
						});

						it('should reject requests when no roles are provided', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: [],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400);
						});

						it('should reject requests when the roles are not an array', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: 'named-user-api-key',
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400, '"Roles should be an array of role names"');
						});

						it('should reject requests when the role is not a non-empty string', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: [''],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400, '"Roles should be an array of role names"');

							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: [5],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400, '"Roles should be an array of role names"');
						});

						it('should reject requests when more than one roles are provided', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key', 'provisioning-api-key'],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(400, '"API Keys currently only support a single role"');
						});

						it('should reject requests for named api keys without a name', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									expiryDate: defaultExpiryDate,
								})
								.expect(
									400,
									`"API keys with the 'named-user-api-key' role require a name"`,
								);
						});

						it('should reject requests for named api keys with an empty name', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									name: '',
									expiryDate: defaultExpiryDate,
								})
								.expect(
									400,
									`"API keys with the 'named-user-api-key' role require a name"`,
								);
						});

						it('should be able to create a named api key', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									name: 'a-different-name',
									expiryDate: defaultExpiryDate,
								})
								.expect(200);
						});

						it('should be able to create an api key with expiry date', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									name: 'Named Key',
									expiryDate: new Date(Date.now() + 86400000).toISOString(), // one day in future
								})
								.expect(200);
						});

						if (apiKeyVersion === 'v1') {
							it('should be able to create an api key without an expiry date', async function () {
								await supertest(this.user)
									.post(`/api-key/${apiKeyVersion}/`)
									.send({
										actorType: 'user',
										actorTypeId: this.user.id,
										roles: ['named-user-api-key'],
										name: 'Named Key',
									})
									.expect(200);
							});
						} else {
							it('should fail to create an api key without an expiry date', async function () {
								await supertest(this.user)
									.post(`/api-key/${apiKeyVersion}/`)
									.send({
										actorType: 'user',
										actorTypeId: this.user.id,
										roles: ['named-user-api-key'],
										name: 'Named Key',
									})
									.expect(400, '"Key expiry date should be a valid date"');
							});
						}

						it('should be able to create an api key with a null expiry date', async function () {
							await supertest(this.user)
								.post(`/api-key/${apiKeyVersion}/`)
								.send({
									actorType: 'user',
									actorTypeId: this.user.id,
									roles: ['named-user-api-key'],
									name: 'Named Key',
									expiryDate: null,
								})
								.expect(200);
						});
					});
				});
			}
		});
	});
};
