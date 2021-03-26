import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import { fetchContractsLocally, getContracts } from './contracts-directory';
import { sbvrUtils, permissions } from '@balena/pinejs';
import {
	CONTRACTS_PRIVATE_REPO_BRANCH,
	CONTRACTS_PRIVATE_REPO_NAME,
	CONTRACTS_PRIVATE_REPO_OWNER,
	CONTRACTS_PRIVATE_REPO_TOKEN,
	CONTRACTS_PUBLIC_REPO_BRANCH,
	CONTRACTS_PUBLIC_REPO_NAME,
	CONTRACTS_PUBLIC_REPO_OWNER,
	MINUTES,
} from '../../lib/config';
import { captureException } from '../../infra/error-handling';
import { scheduleJob } from '../../infra/scheduler';

export interface RepositoryInfo {
	owner: string;
	name: string;
	branch?: string;
	token?: string;
}

export interface ContractAsset {
	url: string;
	name?: string;
}

export interface Contract {
	slug: string;
	version: number;
	type: string;
	aliases?: string[];
	name: string;
	assets?: Dictionary<ContractAsset>;
	data: any;
}

export const getContractRepos = (): RepositoryInfo[] => {
	const repos: RepositoryInfo[] = [
		{
			owner: CONTRACTS_PUBLIC_REPO_OWNER,
			name: CONTRACTS_PUBLIC_REPO_NAME,
			branch: CONTRACTS_PUBLIC_REPO_BRANCH,
		},
	];

	if (
		CONTRACTS_PRIVATE_REPO_OWNER &&
		CONTRACTS_PRIVATE_REPO_NAME &&
		CONTRACTS_PRIVATE_REPO_TOKEN
	) {
		repos.push({
			owner: CONTRACTS_PRIVATE_REPO_OWNER,
			name: CONTRACTS_PRIVATE_REPO_NAME,
			branch: CONTRACTS_PRIVATE_REPO_BRANCH,
			token: CONTRACTS_PRIVATE_REPO_TOKEN,
		});
	}

	return repos;
};

type FieldsMap = {
	[dbField: string]: {
		contractField: string;
		default?: any;
		refersTo?: {
			resource: string;
			uniqueKey: string;
		};
	};
};

type SyncSetting = {
	resource: string;
	uniqueKey: string;
	includeRawContract?: boolean;
	map: FieldsMap;
};

// This map will hold information on which contract fields imported from the contract type will be synced to which db model and fields.
type SyncSettings = {
	[contractType: string]: SyncSetting;
};

let globalSyncSettings: SyncSettings | undefined;

export function setSyncSettings(syncSettings: SyncSettings) {
	globalSyncSettings = syncSettings;
}

const mapModel = async (
	contractEntry: Contract,
	{ includeRawContract, map }: SyncSetting,
	rootApi: sbvrUtils.PinejsClient,
) => {
	const mappedModel: { [k: string]: any } = {};
	if (includeRawContract) {
		mappedModel['contract'] = contractEntry;
	}
	for (const key of Object.keys(map) as Array<keyof typeof map>) {
		const mapper = map[key];

		const contractValue =
			_.get(contractEntry, mapper?.contractField) ?? mapper?.default;

		if (mapper.refersTo && contractValue != null) {
			try {
				const [entry] = await rootApi.get({
					resource: mapper.refersTo.resource,
					options: {
						$filter: { [mapper.refersTo.uniqueKey]: contractValue },
						$select: ['id'],
					},
				});

				mappedModel[key] = entry?.id ?? null;
			} catch (err) {
				console.error(
					`Failed to get contract refer id for field ${key} of resource ${mapper.refersTo.resource}.`,
					err.message,
				);
			}
		} else {
			mappedModel[key] = contractValue ?? null;
		}
	}
	return mappedModel;
};

const upsertEntries = async (
	newData: any[],
	existingData: Set<string | number | boolean>,
	resource: string,
	uniqueField: string,
	rootApi: sbvrUtils.PinejsClient,
) => {
	await Bluebird.map(
		newData,
		async (entry: any) => {
			const entryQuery =
				'contract' in entry && entry.contract != null
					? { ...entry, contract: JSON.stringify(entry.contract) }
					: entry;
			try {
				if (existingData.has(entry[uniqueField])) {
					return await rootApi.patch({
						resource,
						body: entry,
						options: {
							$filter: {
								[uniqueField]: entry[uniqueField],
								$not: entryQuery,
							},
						},
					});
				}

				await rootApi.post({
					resource,
					body: entry,
					options: { returnResource: false },
				});
			} catch (err) {
				console.error(
					`Failed to synchronize ${entry[uniqueField]}, skipping...`,
					err.message,
				);
			}
		},
		{ concurrency: 10 },
	);
};

const syncContractsToDb = async (
	type: string,
	contracts: Contract[],
	syncSettings: SyncSettings | undefined,
) => {
	const typeMap = syncSettings?.[type];
	if (!typeMap) {
		throw new Error(`Contract does not have a corresponding mapping: ${type}`);
	}

	const rootApi = sbvrUtils.api.resin.clone({
		passthrough: { req: permissions.root },
	});

	const mappedModel = contracts.map((contract) =>
		mapModel(contract, typeMap, rootApi),
	);

	const existingEntries = (await rootApi.get({
		resource: typeMap.resource,
		options: { $select: [typeMap.uniqueKey] },
	})) as Array<{ [k in typeof typeMap.uniqueKey]: any }>;

	const existingKeys = new Set(
		existingEntries.map((existingEntry) => existingEntry[typeMap.uniqueKey]),
	);

	await upsertEntries(
		mappedModel,
		existingKeys,
		typeMap.resource,
		typeMap.uniqueKey,
		rootApi,
	);
};

export const synchronizeContracts = async (contractRepos: RepositoryInfo[]) => {
	// We want to separate fetching from syncing, since in air-gapped environments the user can
	// preload the contracts folder inside the container and the sync should still work
	try {
		await fetchContractsLocally(contractRepos);
	} catch (err) {
		console.error(`Failed to fetch contracts, skipping...`, err.message);
	}

	// We don't have automatic dependency resolution, so the order matters here.
	for (const contractType of [
		'arch.sw',
		'hw.device-manufacturer',
		'hw.device-family',
		'hw.device-type',
	]) {
		try {
			const contracts = await getContracts(contractType);
			await syncContractsToDb(contractType, contracts, globalSyncSettings);
		} catch (err) {
			captureException(
				err,
				`Failed to synchronize contract type: ${contractType}, skipping...`,
			);
		}
	}
};

export const startContractSynchronization = _.once(async () => {
	const contractRepos = getContractRepos();

	// Schedule to run every 5 minutes
	scheduleJob(
		'contractSync',
		'*/5 * * * * *',
		async () => await synchronizeContracts(contractRepos),
		{
			// The maximum expected amount of time that the job needs to complete
			// and it should hold the lock to prevent other jobs from starting.
			// If after that point the job hasn't completed, it is considered
			// as crashed and the lock is automatically released.
			ttl: 20 * MINUTES,
		},
	);
});
