import {
	CONTRACTS_PUBLIC_REPO_OWNER,
	CONTRACTS_PUBLIC_REPO_NAME,
	CONTRACTS_PUBLIC_REPO_BRANCH,
} from '../../src/lib/config';
import { RepositoryInfo } from '../../src/features/contracts';
import * as nock from 'nock';
import * as path from 'path';
import * as tar from 'tar';

export const mockRepo = (
	repo: RepositoryInfo,
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
					cwd: path.join(__dirname, `../fixtures/contracts`),
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

export const removeContractInterceptors = mockRepo(
	{
		owner: CONTRACTS_PUBLIC_REPO_OWNER,
		name: CONTRACTS_PUBLIC_REPO_NAME,
		branch: CONTRACTS_PUBLIC_REPO_BRANCH,
	},
	'base-contracts',
	true,
);
