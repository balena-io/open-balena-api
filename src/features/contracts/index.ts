import type Model from '../../balena-model.js';
import _ from 'lodash';
import pMap from 'p-map';
import { fetchContractsLocally, getContracts } from './contracts-directory.js';
import type { types } from '@balena/pinejs';
import { sbvrUtils, permissions } from '@balena/pinejs';
import {
	CONTRACTS_PRIVATE_REPO_BRANCH,
	CONTRACTS_PRIVATE_REPO_NAME,
	CONTRACTS_PRIVATE_REPO_OWNER,
	CONTRACTS_PRIVATE_REPO_TOKEN,
	CONTRACTS_PUBLIC_REPO_BRANCH,
	CONTRACTS_PUBLIC_REPO_NAME,
	CONTRACTS_PUBLIC_REPO_OWNER,
} from '../../lib/config.js';
import { MINUTES } from '@balena/env-parsing';
import { captureException } from '../../infra/error-handling/index.js';
import { scheduleJob } from '../../infra/scheduler/index.js';

type ValidContractResources =
	| 'device_type'
	| 'cpu_architecture'
	| 'device_family'
	| 'device_manufacturer';

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
			resource: ValidContractResources;
			uniqueKey: keyof Model[ValidContractResources]['Read'];
		};
		isReferencedBy?: {
			resource: 'device_type_alias';
			naturalKeyPart: keyof Model['device_type_alias']['Write'];
		};
	};
};

export type SyncSetting = {
	resource: ValidContractResources;
	uniqueKey: keyof Model[ValidContractResources]['Read'];
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
	rootApi: typeof sbvrUtils.api.resin,
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
						$select: 'id',
						$filter: { [mapper.refersTo.uniqueKey]: contractValue },
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

const getReversePropMapEntries = (map: SyncSetting['map']) =>
	Object.entries(map).filter(
		(
			entry,
		): entry is [
			string,
			types.RequiredField<FieldsMap[string], 'isReferencedBy'>,
		] => entry[1].isReferencedBy != null,
	);

const upsertEntries = async (
	rootApi: typeof sbvrUtils.api.resin,
	{ resource, uniqueKey, map }: SyncSetting,
	reversePropMapEntries: ReturnType<typeof getReversePropMapEntries>,
	existingData: Map<string | number | boolean, AnyObject>,
	newData: Array<Promise<AnyObject>>,
) => {
	await pMap(
		newData,
		async (fullEntry) => {
			// Has only the fields that the DB's resource has (primitives & FK),
			// by removing the ReverseNavigationResource properties.
			const entryFieldData = Object.fromEntries(
				Object.entries(fullEntry).filter(
					([key]) => map[key]?.isReferencedBy == null,
				),
			);

			const entryQuery =
				'contract' in entryFieldData && entryFieldData.contract != null
					? {
							...entryFieldData,
							contract: JSON.stringify(entryFieldData.contract),
						}
					: entryFieldData;
			try {
				const uniqueFieldValue = entryFieldData[uniqueKey];
				let existingEntry = existingData.get(uniqueFieldValue);
				if (existingEntry != null) {
					await rootApi.patch({
						resource,
						id: existingEntry.id,
						body: entryFieldData,
						options: {
							$filter: {
								$not: entryQuery,
							},
						},
					});
				} else {
					existingEntry = await rootApi.post({
						resource,
						body: entryFieldData,
						options: { returnResource: reversePropMapEntries.length > 0 },
					});
				}
				// upsert reverse navigation resources defined inline in the contract
				for (const [propKey, { isReferencedBy }] of reversePropMapEntries) {
					const existingUniqueValues = existingEntry[propKey]?.map(
						(e: AnyObject) => e[isReferencedBy.naturalKeyPart],
					);
					const associatedValues = fullEntry[propKey] as unknown[];
					for (const associatedValue of associatedValues) {
						let targetUniqueValue: unknown;
						let extraProperties: AnyObject | undefined;
						if (
							associatedValue != null &&
							typeof associatedValue === 'object' &&
							!(associatedValue instanceof Date)
						) {
							extraProperties = _.omit(
								associatedValue as AnyObject,
								isReferencedBy.naturalKeyPart,
							);
							targetUniqueValue =
								extraProperties[isReferencedBy.naturalKeyPart];
						} else {
							targetUniqueValue = associatedValue;
						}

						const naturalKey = {
							[resource]: existingEntry.id,
							[isReferencedBy.naturalKeyPart]: targetUniqueValue,
						} satisfies Partial<Model[keyof Model]['Write']>;

						if (!existingUniqueValues?.includes(targetUniqueValue)) {
							await rootApi.post({
								resource: isReferencedBy.resource,
								body: {
									...extraProperties,
									...naturalKey,
								},
								options: { returnResource: false },
							});
						} else if (
							extraProperties != null &&
							Object.keys(extraProperties).length > 0
						) {
							await rootApi.patch({
								resource: isReferencedBy.resource,
								id: naturalKey,
								body: extraProperties,
								options: {
									$filter: {
										$not: extraProperties,
									},
								},
							});
						}
					}
				}
			} catch (err) {
				console.error(
					`Failed to synchronize ${fullEntry[uniqueKey]}, skipping...`,
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

	const reversePropMapEntries = getReversePropMapEntries(typeMap.map);
	const $expand = reversePropMapEntries.map(
		([
			key,
			{
				isReferencedBy: { naturalKeyPart },
			},
		]) => ({ [key]: { $select: naturalKeyPart } }),
	);

	const existingEntries = await rootApi.get({
		resource: typeMap.resource,
		options: {
			$select: ['id', typeMap.uniqueKey],
			...($expand.length > 0 && { $expand }),
		},
	});

	const existingData = new Map(
		existingEntries.map((existingEntry) => [
			existingEntry[typeMap.uniqueKey],
			existingEntry,
		]),
	);

	await upsertEntries(
		rootApi,
		typeMap,
		reversePropMapEntries,
		existingData,
		mappedModel,
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

export const startContractSynchronization = _.once(() => {
	const contractRepos = getContractRepos();

	// Schedule to run every 5 minutes
	scheduleJob(
		'contractSync',
		'*/5 * * * *',
		async () => {
			await synchronizeContracts(contractRepos);
		},
		{
			// The maximum expected amount of time that the job needs to complete
			// and it should hold the lock to prevent other jobs from starting.
			// If after that point the job hasn't completed, it is considered
			// as crashed and the lock is automatically released.
			ttl: 20 * MINUTES,
		},
	);
});
