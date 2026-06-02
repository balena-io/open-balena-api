import { fileURLToPath } from 'node:url';
import { buffer } from 'node:stream/consumers';
import {
	CONTRACTS_PUBLIC_REPO_OWNER,
	CONTRACTS_PUBLIC_REPO_NAME,
	CONTRACTS_PUBLIC_REPO_BRANCH,
} from '../../src/lib/config.js';
import type { RepositoryInfo } from '../../src/features/contracts/index.js';
import { getMockServer } from './mockttp-server.js';
import * as tar from 'tar';

const GITHUB_API_HOST = 'api.github.com';
const CODELOAD_HOST = 'codeload.github.com';

const contractsFixtureDir = fileURLToPath(
	new URL('../fixtures/contracts', import.meta.url),
);

// mockttp response bodies must be a string/Buffer, so collect the gzipped tar
// stream (which nock consumed lazily) into a Buffer up front, per request.
const tarballBuffer = (filename: string) =>
	buffer(tar.create({ gzip: true, cwd: contractsFixtureDir }, [filename]));

const registerRepoRules = async (
	repo: RepositoryInfo,
	filename: string,
	{ persist, enabled }: { persist: boolean; enabled?: () => boolean },
) => {
	const server = getMockServer();
	const branch = repo.branch ?? 'master';

	let redirect = server
		.forGet(`/repos/${repo.owner}/${repo.name}/tarball/${repo.branch ?? ''}`)
		.forHostname(GITHUB_API_HOST);
	let file = server
		.forGet(`/${repo.owner}/${repo.name}/legacy.tar.gz/${branch}`)
		.forHostname(CODELOAD_HOST);

	// An optional predicate lets a rule be toggled on/off without removing it from
	// the shared server (mockttp has no single-rule removal).
	if (enabled != null) {
		redirect = redirect.matching(enabled);
		file = file.matching(enabled);
	}

	// nock's `.persist(false)` matches once then is consumed; `.persist(true)`
	// matches forever. mockttp's `.once()` / `.always()` are the equivalents.
	redirect = persist ? redirect.always() : redirect.once();
	file = persist ? file.always() : file.once();

	await redirect.thenReply(302, '', {
		Location: `https://${CODELOAD_HOST}/${repo.owner}/${repo.name}/legacy.tar.gz/${branch}`,
	});
	await file.thenCallback(async () => ({
		statusCode: 200,
		body: await tarballBuffer(filename),
		headers: {
			'content-type': 'application/x-gzip',
			'content-disposition': `attachment; filename=${filename}.tar.gz`,
		},
	}));
};

// Per-test, single-shot mock for one contracts fetch (302 redirect + tarball).
export const mockRepo = async (repo: RepositoryInfo, filename = repo.name) => {
	await registerRepoRules(repo, filename, { persist: false });
};

// The base contracts repo is mocked persistently for the whole suite. 09_contracts
// toggles it off/on while exercising bespoke fetch scenarios, so it is gated behind
// a flag rather than added/removed as a rule (mockttp keeps a single shared server).
let baseContractsEnabled = false;
let installed = false;

export const installContractMocks = async () => {
	if (installed) {
		return;
	}
	installed = true;
	baseContractsEnabled = true;
	await registerRepoRules(
		{
			owner: CONTRACTS_PUBLIC_REPO_OWNER,
			name: CONTRACTS_PUBLIC_REPO_NAME,
			branch: CONTRACTS_PUBLIC_REPO_BRANCH,
		},
		'base-contracts',
		{ persist: true, enabled: () => baseContractsEnabled },
	);
};

export const addContractInterceptors = () => {
	baseContractsEnabled = true;
};

export const removeContractInterceptors = () => {
	baseContractsEnabled = false;
};
