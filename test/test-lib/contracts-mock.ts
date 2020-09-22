import * as nock from 'nock';
import * as path from 'path';
import * as tar from 'tar';

export const mockRepo = (
	owner: string,
	name: string,
	filename = name,
	persist = false,
) => {
	const redirectInterceptor = nock('https://api.github.com')
		.persist(persist)
		.get(`/repos/${owner}/${name}/tarball`);

	redirectInterceptor.reply(302, undefined, {
		Location: `https://codeload.github.com/${owner}/${name}/legacy.tar.gz/master`,
	});

	const fileInterceptor = nock('https://codeload.github.com/')
		.persist(persist)
		.get(`/${owner}/${name}/legacy.tar.gz/master`);

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
	'balena-io',
	'contracts',
	'base-contracts',
	true,
);
