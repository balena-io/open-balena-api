import {
	fetchContractsLocally,
	getContracts,
	removeContractDirectory,
} from '../src/features/contracts/contracts-directory.js';
import { expect } from 'chai';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';
import {
	removeContractInterceptors,
	mockRepo,
	addContractInterceptors,
} from './test-lib/contracts-mock.js';
import { contracts as $contracts } from '@balena/open-balena-api';
import { sbvrUtils, permissions } from '@balena/pinejs';
import type {
	DeviceType,
	DeviceTypeAlias,
} from '@balena/open-balena-api/models/balena-model.d.ts';
import { assertExists } from './test-lib/common.js';

const { synchronizeContracts } = $contracts;

const contractRepository: $contracts.RepositoryInfo = {
	owner: 'balena-io',
	name: 'contracts',
};

const clearDeviceTypeResource = async () => {
	await sbvrUtils.api.resin.delete({
		resource: 'device_type_alias',
		passthrough: { req: permissions.root },
	});

	await sbvrUtils.api.resin.delete({
		resource: 'device_type',
		passthrough: { req: permissions.root },
	});
};

export default () => {
	versions.test((version, pineTest) => {
		const compareContractsToDb = async ({
			contract,
			db,
		}: {
			contract: string;
			db: string;
		}) => {
			const fromContracts = (await getContracts(contract))
				.map((x) => x.slug)
				.sort();
			const fromDb = (
				await supertest().get(`/${version}/${db}`).expect(200)
			).body.d
				.map((x: { slug: string }) => x.slug)
				.sort();

			expect(fromContracts).to.deep.equal(fromDb);
		};

		describe('contracts', () => {
			before(() => {
				removeContractInterceptors();
			});

			after(async () => {
				await removeContractDirectory();
				await clearDeviceTypeResource();

				addContractInterceptors();
				await synchronizeContracts([contractRepository]);
				// Reload the device-type fixtures, since after
				// synchronizeContracts() the DB IDs have changed.
				(await import('./test-lib/device-type.js')).loadDefaultFixtures();
			});

			beforeEach(async () => {
				await removeContractDirectory();
			});

			describe('contract fetching', () => {
				it('should fetch the specified contracts repo locally', async () => {
					mockRepo(contractRepository, 'base-contracts');
					await fetchContractsLocally([contractRepository]);
					const contracts = await getContracts('hw.device-type');

					expect(contracts).to.have.length(16);
					assertExists(
						contracts.find((contract) => contract.slug === 'raspberrypi3'),
					);
				});

				it('should merge multiple contracts repos', async () => {
					const otherContractRepository = {
						...contractRepository,
						name: 'other-contracts',
					};
					mockRepo(contractRepository, 'base-contracts');
					mockRepo(otherContractRepository);
					await fetchContractsLocally([
						contractRepository,
						otherContractRepository,
					]);
					const contracts = await getContracts('hw.device-type');

					expect(contracts).to.have.length(17);
					assertExists(
						contracts.find((contract) => contract.slug === 'other-contract-dt'),
					);
				});

				it('should normalize the assets included with the contracts', async () => {
					const otherContractRepository = {
						...contractRepository,
						name: 'other-contracts',
					};
					mockRepo(contractRepository, 'base-contracts');
					mockRepo(otherContractRepository);
					await fetchContractsLocally([
						contractRepository,
						otherContractRepository,
					]);

					const contracts = await getContracts('hw.device-type');
					const rpiContract = contracts.find(
						(contract) => contract.slug === 'raspberry-pi',
					);
					const rpi3Contract = contracts.find(
						(contract) => contract.slug === 'raspberrypi3',
					);
					const otherDtContract = contracts.find(
						(contract) => contract.slug === 'other-contract-dt',
					);

					expect(rpi3Contract?.assets?.logo).to.exist;
					expect(rpi3Contract?.assets?.logo.url).to.contain(
						'data:image/svg+xml;base64,',
					);
					expect(rpi3Contract?.assets?.logo.url).to.have.length(6850);

					expect(otherDtContract?.assets?.logo).to.exist;
					expect(otherDtContract?.assets?.logo.url).to.equal(
						'https://balena.io/logo.png',
					);

					expect(rpi3Contract?.aliases).to.deep.equal(
						['raspberrypi3'],
						'Should use the slug as an alias when there are none',
					);
					expect(rpiContract?.aliases?.slice().sort()).to.deep.equal(
						['raspberry-pi', 'raspberrypi'],
						'Should include the slug in the list of aliases',
					);
				});

				it('should update data as the contracts change', async () => {
					mockRepo(contractRepository, 'base-contracts');
					await fetchContractsLocally([contractRepository]);

					// A new device type was added, and the fin contract was modified in the updated contracts tarball.
					mockRepo(contractRepository, 'updated-base-contracts');
					await fetchContractsLocally([contractRepository]);

					const contracts = await getContracts('hw.device-type');

					const newDt = contracts.find(
						(dbDeviceType) => dbDeviceType.slug === 'new-dt',
					);
					const finDt = contracts.find(
						(dbDeviceType) => dbDeviceType.slug === 'fincm3',
					);

					expect(contracts).to.have.length(17);
					assertExists(newDt);
					expect(finDt).to.have.property('name', 'Fin');
				});
			});

			describe('contract synchronization', () => {
				before(async function () {
					await clearDeviceTypeResource();
				});

				it('should write the set contract data to the DB', async () => {
					mockRepo(contractRepository, 'base-contracts');
					await synchronizeContracts([contractRepository]);
					await Promise.all(
						[
							{ contract: 'hw.device-type', db: 'device_type' },
							{ contract: 'arch.sw', db: 'cpu_architecture' },
							{ contract: 'hw.device-family', db: 'device_family' },
							{ contract: 'hw.device-manufacturer', db: 'device_manufacturer' },
						].map(compareContractsToDb),
					);
				});

				it('should update the DB data once a contract changes', async () => {
					mockRepo(contractRepository, 'base-contracts');
					await synchronizeContracts([contractRepository]);

					mockRepo(contractRepository, 'updated-base-contracts');
					await synchronizeContracts([contractRepository]);

					const contracts = await getContracts('hw.device-type');

					const finDtContract = contracts.find(
						(dbDeviceType) => dbDeviceType.slug === 'fincm3',
					);

					const { body: dbDeviceTypes } = await pineTest
						.get<
							Array<
								DeviceType['Read'] & {
									device_type_alias: Array<
										Pick<DeviceTypeAlias['Read'], 'is_referenced_by__alias'>
									>;
								}
							>
						>({
							resource: 'device_type',
							options: {
								$select: ['slug', 'name', 'contract'],
								$expand: {
									device_type_alias: {
										$select: 'is_referenced_by__alias',
									},
								},
							},
						} as const)
						.expect(200);

					const newDt = dbDeviceTypes.find(
						(dbDeviceType) => dbDeviceType.slug === 'new-dt',
					);
					const finDt = dbDeviceTypes.find(
						(dbDeviceType) => dbDeviceType.slug === 'fincm3',
					);
					const rpiDt = dbDeviceTypes.find(
						(dbDeviceType) => dbDeviceType.slug === 'raspberry-pi',
					);

					expect(dbDeviceTypes).to.have.length(17);
					assertExists(newDt);
					expect(finDt).to.have.property('name', 'Fin');
					expect(finDt).to.have.deep.property(
						'contract',
						JSON.parse(JSON.stringify(finDtContract)),
					);

					assertExists(rpiDt);
					expect(rpiDt)
						.to.have.property('device_type_alias')
						.that.is.an('array');
					expect(
						rpiDt.device_type_alias
							.map((a) => a.is_referenced_by__alias)
							.sort(),
					).to.deep.equal(['raspberry-pi', 'raspberrypi']);
				});
			});
		});
	});
};
