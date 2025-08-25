import _ from 'lodash';
import request from 'request';
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
	assets: Contract['assets'],
) => {
	if (!assets || _.isEmpty(assets)) {
		return assets;
	}

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

		contract.assets = await normalizeAssets(contractFilepath, contract.assets);
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
	await fs.promises.rmdir(CONTRACTS_BASE_DIR, { recursive: true });
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

const getRequestOptions = (repo: RepositoryInfo) => {
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
		followRedirect: true,
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
			const untar = tar.extract({
				C: await prepareContractDirectory(repo),
				strip: 1,
			});

			// We cast to ReadableStream explicitly because `request.get is of type `request.Request` and it controls whether it is a readable or writable stream internally so it is not typings-compatible with ReadableStream, even though it it functionally equivalent.
			const get = request
				.get(getArchiveLinkForRepo(repo), getRequestOptions(repo))
				.on('response', function (this: request.Request, response) {
					if (response.statusCode !== 200) {
						// On any non-200 responses just error and abort the request
						this.emit(
							'error',
							new Error(
								`Invalid response while fetching contracts: ${response.statusMessage}`,
							),
						);
						this.abort();
					}
				}) as unknown as NodeJS.ReadableStream;

			await stream.promises.pipeline(get, untar);
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
		const slugRegex = new RegExp(`/contracts/(${_.escapeRegExp(type)}/[^/]+)/`);
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

	return _.uniqBy(contracts, 'slug');
};
