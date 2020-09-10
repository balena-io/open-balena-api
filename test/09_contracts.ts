import * as _ from 'lodash';
import {
	fetchContractsLocally,
	getContracts,
	removeContractDirectory,
} from '../src/features/contracts/contracts-directory';
import { expect } from './test-lib/chai';
import { supertest } from './test-lib/supertest';
import {
	removeContractInterceptors,
	mockRepo,
} from './test-lib/contracts-mock';
import { synchronizeContracts } from '../src/features/contracts';
import { api } from '@balena/pinejs/out/sbvr-api/sbvr-utils';
import { permissions } from '@balena/pinejs';
import { DeviceType } from './test-lib/device-type';

const clearDeviceTypeResource = () => {
	return api.resin.delete({
		resource: 'device_type',
		passthrough: { req: permissions.root },
	});
};

describe('contracts', () => {
	before(() => {
		removeContractInterceptors();
	});

	after(async () => {
		await removeContractDirectory();
		await clearDeviceTypeResource();

		mockRepo('balena-io', 'contracts', 'base-contracts', true);
		await synchronizeContracts([{ owner: 'balena-io', name: 'contracts' }]);
	});

	beforeEach(async () => {
		await removeContractDirectory();
	});

	describe('contract fetching', () => {
		it('should fetch the specified contracts repo locally', async () => {
			mockRepo('balena-io', 'contracts', 'base-contracts');
			await fetchContractsLocally([{ owner: 'balena-io', name: 'contracts' }]);
			const contracts = await getContracts('hw.device-type');

			expect(contracts).to.have.length(13);
			expect(contracts.find((contract) => contract.slug === 'raspberrypi3')).to
				.not.be.undefined;
		});

		it('should merge multiple contracts repos', async () => {
			mockRepo('balena-io', 'contracts', 'base-contracts');
			mockRepo('balena-io', 'other-contracts');
			await fetchContractsLocally([
				{ owner: 'balena-io', name: 'contracts' },
				{ owner: 'balena-io', name: 'other-contracts' },
			]);
			const contracts = await getContracts('hw.device-type');

			expect(contracts).to.have.length(14);
			expect(
				contracts.find((contract) => contract.slug === 'other-contract-dt'),
			).to.not.be.undefined;
		});

		it('should update data as the contracts change', async () => {
			mockRepo('balena-io', 'contracts', 'base-contracts');
			await fetchContractsLocally([{ owner: 'balena-io', name: 'contracts' }]);

			// A new device type was added, and the fin contract was modified in the updated contracts tarball.
			mockRepo('balena-io', 'contracts', 'updated-base-contracts');
			await fetchContractsLocally([{ owner: 'balena-io', name: 'contracts' }]);

			const contracts = await getContracts('hw.device-type');

			const newDt = contracts.find(
				(dbDeviceType) => dbDeviceType.slug === 'new-dt',
			);
			const finDt = contracts.find(
				(dbDeviceType) => dbDeviceType.slug === 'fincm3',
			);

			expect(contracts).to.have.length(14);
			expect(newDt).to.not.be.undefined;
			expect(finDt).to.have.property('name', 'Fin');
		});
	});

	describe('contract synchronization', () => {
		before(async function () {
			await clearDeviceTypeResource();
		});

		it('should write the set contract data to the DB', async () => {
			mockRepo('balena-io', 'contracts', 'base-contracts');
			await synchronizeContracts([{ owner: 'balena-io', name: 'contracts' }]);

			const deviceTypes = (await getContracts('hw.device-type'))
				.map((x) => x.slug)
				.sort();

			const cpuArch = (await getContracts('arch.sw')).map((x) => x.slug).sort();

			const dbDeviceTypes = (
				await supertest().get('/resin/device_type').expect(200)
			).body.d
				.map((x: { slug: string }) => x.slug)
				.sort();

			const dbCpuArch = (
				await supertest().get('/resin/cpu_architecture').expect(200)
			).body.d
				.map((x: { slug: string }) => x.slug)
				.sort();

			expect(dbDeviceTypes).to.have.length(13);
			expect(deviceTypes).to.eql(dbDeviceTypes);
			expect(cpuArch).to.eql(dbCpuArch);
		});

		it('should update the DB data once a contract changes', async () => {
			mockRepo('balena-io', 'contracts', 'base-contracts');
			await synchronizeContracts([{ owner: 'balena-io', name: 'contracts' }]);

			mockRepo('balena-io', 'contracts', 'updated-base-contracts');
			await synchronizeContracts([{ owner: 'balena-io', name: 'contracts' }]);

			const dbDeviceTypes: DeviceType[] = (
				await supertest().get('/resin/device_type').expect(200)
			).body.d;

			const newDt = dbDeviceTypes.find(
				(dbDeviceType) => dbDeviceType.slug === 'new-dt',
			);
			const finDt = dbDeviceTypes.find(
				(dbDeviceType) => dbDeviceType.slug === 'fincm3',
			);

			expect(dbDeviceTypes).to.have.length(14);
			expect(newDt).to.not.be.undefined;
			expect(finDt).to.have.property('name', 'Fin');
		});
	});
});
