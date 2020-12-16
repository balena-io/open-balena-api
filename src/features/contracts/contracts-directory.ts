import * as _ from 'lodash';
import * as request from 'request';
import * as tar from 'tar';
import * as glob from 'fast-glob';
import * as fs from 'fs';
import * as util from 'util';
import * as stream from 'stream';
import * as path from 'path';
import * as os from 'os';
import validator from 'validator';
import type { RepositoryInfo, Contract } from './index';
import { getBase64DataUri } from '../../lib/utils';
import { captureException } from '../../infra/error-handling';

const pipeline = util.promisify(stream.pipeline);
const exists = util.promisify(fs.exists);
const mkdir = util.promisify(fs.mkdir);

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

			try {
				normalizedAssets[key] = {
					...asset,
					url: await handleLocalAssetUrl(assetRealPath),
				};
			} catch (e) {
				captureException(
					new Error('Normalizing contract asset failed'),
					`Failed to normalize contract asset for url ${assetRealPath}, excluding asset`,
				);
			}
		}),
	);

	return normalizedAssets;
};

const getArchiveLinkForRepo = (repo: RepositoryInfo) => {
	return `https://api.github.com/repos/${repo.owner}/${repo.name}/tarball`;
};

export const removeContractDirectory = async () => {
	await fs.promises.rmdir(CONTRACTS_BASE_DIR, { recursive: true });
};

const prepareContractDirectory = async (repo: RepositoryInfo) => {
	const archiveDir = path.join(
		CONTRACTS_BASE_DIR,
		`${repo.owner}-${repo.name}`,
	);
	if (!(await exists(archiveDir))) {
		await mkdir(archiveDir, { recursive: true });
	}

	return archiveDir;
};

const getRequestOptions = (repo: RepositoryInfo) => {
	const auth = repo.token
		? `Basic ${Buffer.from(repo.token).toString('base64')}`
		: '';
	return {
		followRedirect: true,
		headers: {
			'User-Agent': 'balena',
			Authorization: auth,
		},
	};
};

const handleResponse: request.RequestCallback = (err, response) => {
	if (!err && response.statusCode === 200) {
		return;
	}

	throw (
		err ??
		new Error(
			`Invalid response while fetching contracts: ${response.statusMessage}`,
		)
	);
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
			const get = (request.get(
				getArchiveLinkForRepo(repo),
				getRequestOptions(repo),
				handleResponse,
			) as unknown) as NodeJS.ReadableStream;

			await pipeline(get, untar);
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

	const contractFiles = await glob(
		`${CONTRACTS_BASE_DIR}/**/contracts/${type}/**/*.json`,
	);
	if (!contractFiles.length) {
		return [];
	}

	const contracts = await Promise.all(
		contractFiles.map(async (file) => {
			const contract = JSON.parse(
				await fs.promises.readFile(file, { encoding: 'utf8' }),
			);

			contract.assets = await normalizeAssets(file, contract.assets);
			return contract;
		}),
	);

	return _.uniqBy(contracts, 'slug');
};
