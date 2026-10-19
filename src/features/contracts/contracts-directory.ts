import _ from 'lodash';
import * as tar from 'tar';
import glob from 'fast-glob';
import fs from 'fs';
import stream from 'stream';
import path from 'path';
import os from 'os';
import validator from 'validator';
import type { RepositoryInfo, Contract } from './index.js';
import { getBase64DataUri } from '../../lib/utils.js';
import { captureException } from '../../infra/error-handling/index.js';
import { CONTRACT_ALLOWLIST } from '../../lib/config.js';

const CONTRACTS_BASE_DIR = path.join(os.tmpdir(), 'contracts');

// All assets that are stored together with the contract are encoded and stored in a dataurl format.
const handleLocalAssetUrl = async (assetUrl: string): Promise<string> => {
	switch (path.extname(assetUrl)) {
		case '.svg': {
			return getBase64DataUri(assetUrl, 'image/svg+xml');
		}
		case '.png': {
			return getBase64DataUri(assetUrl, 'image/png');
		}
		default:
			return '';
	}
};

const normalizeAssets = async (
	contractFilepath: string,
	assets: NonNullable<Contract['assets']>,
) => {
	const normalizedAssets: Contract['assets'] = {};

	await Promise.all(
		Object.entries(assets).map(async ([key, asset]) => {
			if (validator.isURL(asset.url)) {
				normalizedAssets[key] = asset;
				return;
			}

			try {
				// Convert from relative to absolute path for the asset file and make sure it doesn't try to access files outside of the contract folder.
				const contractDir = path.dirname(contractFilepath);
				const assetRealPath = await fs.promises.realpath(
					path.join(contractDir, asset.url),
				);

				if (!assetRealPath.startsWith(contractDir)) {
					captureException(
						new Error('Invalid contract asset URL'),
						`Contract asset URL '${asset.url}' is invalid, excluding asset from contract`,
					);
					return;
				}

				normalizedAssets[key] = {
					...asset,
					url: await handleLocalAssetUrl(assetRealPath),
				};
			} catch (err) {
				captureException(
					err,
					`Failed to normalize contract asset for url ${asset.url}, excluding asset`,
				);
			}
		}),
	);

	return normalizedAssets;
};

const normalizeContract = async (
	contractFilepath: string,
	contract: Contract,
) => {
	try {
		contract.aliases ??= [];
		if (
			Array.isArray(contract.aliases) &&
			!contract.aliases.includes(contract.slug)
		) {
			contract.aliases.push(contract.slug);
		}

		if (contract.assets != null) {
			contract.assets = await normalizeAssets(
				contractFilepath,
				contract.assets,
			);
		}
	} catch (err) {
		captureException(
			err,
			`Failed to normalize contract on path ${contractFilepath}, skipping contract`,
		);
	}
	return contract;
};

const getArchiveLinkForRepo = (repo: RepositoryInfo) => {
	return `https://api.github.com/repos/${repo.owner}/${repo.name}/tarball/${
		repo.branch ?? ''
	}`;
};

export const removeContractDirectory = async () => {
	await fs.promises.rm(CONTRACTS_BASE_DIR, { recursive: true });
};

const prepareContractDirectory = async (repo: RepositoryInfo) => {
	const archiveDir = path.join(
		CONTRACTS_BASE_DIR,
		`${repo.owner}-${repo.name}`,
	);
	try {
		await fs.promises.access(archiveDir);
	} catch {
		// If the directory doesn't exist, create it
		await fs.promises.mkdir(archiveDir, { recursive: true });
	}

	return archiveDir;
};

const getRequestInit = (repo: RepositoryInfo): RequestInit => {
	const auth =
		repo.token == null
			? ''
			: // legacy `username:token` Basic authentication.
				// TODO: Consider dropping in the next major
				/^([\w-])+:\w+$/.test(repo.token)
				? `Basic ${Buffer.from(repo.token).toString('base64')}`
				: // direct token consumption (eg: Personal Access Token authentication)
					`Bearer ${repo.token}`;
	return {
		redirect: 'follow',
		headers: {
			'User-Agent': 'balena',
			Authorization: auth,
		},
	};
};

// Keeps the contract repos locally and in sync with upstream, if accessible.
export const fetchContractsLocally = async (repos: RepositoryInfo[]) => {
	await Promise.all(
		repos.map(async (repo) => {
			const archiveDir = await prepareContractDirectory(repo);

			const response = await fetch(
				getArchiveLinkForRepo(repo),
				getRequestInit(repo),
			);
			if (response.status !== 200 || response.body == null) {
				// On any non-200 responses just error. We won't consume the body, so
				// cancel it to release the underlying connection.
				await response.body?.cancel();
				throw new Error(
					`Invalid response while fetching contracts: ${response.status} ${response.statusText}`,
				);
			}

			await stream.promises.pipeline(
				response.body,
				tar.extract({ C: archiveDir, strip: 1 }),
			);
		}),
	);
};

export const getContracts = async (type: string): Promise<Contract[]> => {
	if (!type) {
		return [];
	}

	const contractDirs = await glob(`${CONTRACTS_BASE_DIR}/**`);
	if (!contractDirs.length) {
		return [];
	}

	let contractFiles = await glob(
		`${CONTRACTS_BASE_DIR}/**/contracts/${type}/**/*.json`,
	);
	if (!contractFiles.length) {
		return [];
	}

	// If there are explicit includes, then everything else is excluded so we need to
	// filter the contractFiles list to include only contracts that are in the CONTRACT_ALLOWLIST map
	if (CONTRACT_ALLOWLIST.size > 0) {
		const slugRegex = new RegExp(`/contracts/(${RegExp.escape(type)}/[^/]+)/`);
		const before = contractFiles.length;
		contractFiles = contractFiles.filter((file) => {
			// Get the contract slug from the file path
			const deviceTypeSlug = file.match(slugRegex)?.[1];
			if (!deviceTypeSlug) {
				return false;
			}

			// Check if this slug is included in the map
			return CONTRACT_ALLOWLIST.has(deviceTypeSlug);
		});

		console.log(
			`CONTRACT_ALLOWLIST reduced ${type} contract slugs from ${before} to ${contractFiles.length}`,
		);
	}

	const contracts = await Promise.all(
		contractFiles.map(async (file) => {
			let contract;
			try {
				contract = JSON.parse(
					await fs.promises.readFile(file, { encoding: 'utf8' }),
				);
			} catch (err) {
				err.message = `Failed to parse contract '${file}': ${err.message}`;
				throw err;
			}

			return await normalizeContract(file, contract);
		}),
	);

	return _.uniqBy(contracts, (contract) => contract.slug);
};
