import { fileURLToPath } from 'node:url';
import {
	CONTRACTS_PUBLIC_REPO_OWNER,
	CONTRACTS_PUBLIC_REPO_NAME,
	CONTRACTS_PUBLIC_REPO_BRANCH,
} from '@balena/open-balena-api/config';
import type { contracts } from '@balena/open-balena-api';
import nock from 'nock';
import * as tar from 'tar';

export const mockRepo = (
	repo: contracts.RepositoryInfo,
	filename = repo.name,
	persist = false,
) => {
	const redirectInterceptor = nock('https://api.github.com')
		.persist(persist)
		.get(`/repos/${repo.owner}/${repo.name}/tarball/${repo.branch ?? ''}`);

	redirectInterceptor.reply(302, undefined, {
		Location: `https://codeload.github.com/${repo.owner}/${
			repo.name
		}/legacy.tar.gz/${repo.branch ?? 'master'}`,
	});

	const fileInterceptor = nock('https://codeload.github.com/')
		.persist(persist)
		.get(
			`/${repo.owner}/${repo.name}/legacy.tar.gz/${repo.branch ?? 'master'}`,
		);

	fileInterceptor.reply(
		200,
		() => {
			return tar.create(
				{
					gzip: true,
					cwd: fileURLToPath(new URL('../fixtures/contracts', import.meta.url)),
				},
				[filename],
			);
		},
		{
			'Content-Type': 'application/x-gzip',
			'Content-Disposition': `attachment; filename=${filename}.tar.gz`,
		},
	);

	return () => {
		nock.removeInterceptor(redirectInterceptor);
		nock.removeInterceptor(fileInterceptor);
	};
};

export let removeContractInterceptors: () => void;
export const addContractInterceptors = () => {
	removeContractInterceptors = mockRepo(
		{
			owner: CONTRACTS_PUBLIC_REPO_OWNER,
			name: CONTRACTS_PUBLIC_REPO_NAME,
			branch: CONTRACTS_PUBLIC_REPO_BRANCH,
		},
		'base-contracts',
		true,
	);
};
addContractInterceptors();
