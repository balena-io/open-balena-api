import {
	fetchContractsLocally,
	getContracts,
	removeContractDirectory,
} from '../src/features/contracts/contracts-directory';
import { expect } from 'chai';
import { supertest } from './test-lib/supertest';
import { version } from './test-lib/versions';
import {
	removeContractInterceptors,
	mockRepo,
} from './test-lib/contracts-mock';
import {
	RepositoryInfo,
	synchronizeContracts,
} from '../src/features/contracts';
import { sbvrUtils, permissions } from '@balena/pinejs';
import { pineTest } from './test-lib/pinetest';
import type { DeviceType, DeviceTypeAlias } from '../src/balena-model';

const contractRepository: RepositoryInfo = {
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
	const fromDb = (await supertest().get(`/${version}/${db}`).expect(200)).body.d
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

		mockRepo(contractRepository, 'base-contracts', true);
		await synchronizeContracts([contractRepository]);
		// Reload the device-type fixtures, since after
		// synchronizeContracts() the DB IDs have changed.
		(await import('./test-lib/device-type')).loadDefaultFixtures();
	});

	beforeEach(async () => {
		await removeContractDirectory();
	});

	describe('contract fetching', () => {
		it('should fetch the specified contracts repo locally', async () => {
			mockRepo(contractRepository, 'base-contracts');
			await fetchContractsLocally([contractRepository]);
			const contracts = await getContracts('hw.device-type');

			expect(contracts).to.have.length(14);
			expect(contracts.find((contract) => contract.slug === 'raspberrypi3')).to
				.not.be.undefined;
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

			expect(contracts).to.have.length(15);
			expect(
				contracts.find((contract) => contract.slug === 'other-contract-dt'),
			).to.not.be.undefined;
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

			expect(contracts).to.have.length(15);
			expect(newDt).to.not.be.undefined;
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
						DeviceType & {
							device_type_alias: Array<
								Pick<DeviceTypeAlias, 'is_referenced_by__alias'>
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
				})
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

			expect(dbDeviceTypes).to.have.length(15);
			expect(newDt).to.not.be.undefined;
			expect(finDt).to.have.property('name', 'Fin');
			expect(finDt).to.have.deep.property(
				'contract',
				JSON.parse(JSON.stringify(finDtContract)),
			);

			expect(rpiDt).to.have.property('device_type_alias').that.is.an('array');
			expect(
				rpiDt!.device_type_alias.map((a) => a.is_referenced_by__alias).sort(),
			).to.deep.equal(['raspberry-pi', 'raspberrypi']);
		});
	});
});
