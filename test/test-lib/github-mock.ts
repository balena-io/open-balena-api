import * as Octokit from '@octokit/rest';
import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as mockery from 'mockery';

import getContent = require('../fixtures/github/getContent.json');

class GHMock {
	public repos = {
		getArchiveLink(
			params?: Octokit.RequestOptions & Octokit.ReposGetArchiveLinkParams,
		): Promise<Octokit.AnyResponse> {
			if (!params) {
				return Bluebird.reject(
					new Error(`gh mock: No parameters provided for get content call.`),
				);
			}

			const contentKey = `getArchiveLink/${params.owner}/${params.repo}/${params.ref}`;

			if (!_.has(getContent, contentKey)) {
				return Bluebird.reject(
					new Error(
						`gh mock: getContents could not find a mock for ${contentKey}`,
					),
				);
			}

			const response: Octokit.AnyResponse = ({
				data: null,
				status: 302,
				headers: {
					date: 'Tue, 08 Oct 2019 14:53:13 GMT',
					'x-ratelimit-limit': '60',
					'x-ratelimit-remaining': '59',
					'x-ratelimit-reset': '1570549993',
					'x-Octokit-request-id': '123345',
					'x-Octokit-media-type': 'github.v3; format=json',
					link: '',
					'last-modified': 'Wed, 02 Oct 2019 12:09:34 GMT',
					etag: '63b1e55e670df084b122deba00768fe52ad424b7',
					status: '',
					Location: getContent[contentKey as keyof typeof getContent],
				},
				url: getContent[contentKey as keyof typeof getContent],
			} as any) as Octokit.AnyResponse;
			return Bluebird.resolve(response);
		},
		getBranch(
			params?: Octokit.RequestOptions & Octokit.ReposGetBranchParams,
		): Promise<Octokit.Response<Octokit.ReposGetBranchResponse>> {
			if (!params) {
				return Bluebird.reject(
					new Error(`gh mock: No parameters provided for get content call.`),
				);
			}

			const contentKey = `getBranch/${params.owner}/${params.repo}/${params.branch}`;

			if (!_.has(getContent, contentKey)) {
				return Bluebird.reject(
					new Error(
						`gh mock: getContents could not find a mock for ${contentKey}`,
					),
				);
			}

			const response: Octokit.Response<Octokit.ReposGetBranchResponse> = {
				data: getContent[
					contentKey as keyof typeof getContent
				] as Octokit.ReposGetBranchResponse,
				status: 200,
				headers: {
					date: 'Tue, 08 Oct 2019 14:53:13 GMT',
					'x-ratelimit-limit': '60',
					'x-ratelimit-remaining': '59',
					'x-ratelimit-reset': '1570549993',
					'x-Octokit-request-id': '123345',
					'x-Octokit-media-type': 'github.v3; format=json',
					link: '',
					'last-modified': 'Wed, 02 Oct 2019 12:09:34 GMT',
					etag: '63b1e55e670df084b122deba00768fe52ad424b7',
					status: '',
				},
			} as Octokit.Response<Octokit.ReposGetBranchResponse>;
			return Bluebird.resolve(response);
		},
		getContents(
			params?: Octokit.RequestOptions & Octokit.ReposGetContentsParams,
		): Promise<Octokit.Response<Octokit.ReposGetContentsResponse>> {
			if (!params) {
				return Bluebird.reject(
					new Error(`gh mock: No parameters provided for get content call.`),
				);
			}
			const contentKey = `${params.owner}/${params.repo}/${params.path}`;

			if (!_.has(getContent, contentKey)) {
				return Bluebird.reject(
					new Error(
						`gh mock: getContents could not find a mock for ${contentKey}`,
					),
				);
			}

			const response: Octokit.Response<Octokit.ReposGetContentsResponse> = {
				data: getContent[
					contentKey as keyof typeof getContent
				] as Octokit.ReposGetContentsResponse,
				status: 200,
				headers: {
					date: 'Tue, 08 Oct 2019 14:53:13 GMT',
					'x-ratelimit-limit': '60',
					'x-ratelimit-remaining': '59',
					'x-ratelimit-reset': '1570549993',
					'x-Octokit-request-id': '123345',
					'x-Octokit-media-type': 'github.v3; format=json',
					link: '',
					'last-modified': 'Wed, 02 Oct 2019 12:09:34 GMT',
					etag: '63b1e55e670df084b122deba00768fe52ad424b7',
					status: '',
				},
			} as Octokit.Response<Octokit.ReposGetContentsResponse>;
			return Bluebird.resolve(response);
		},
	};
}

mockery.enable({ warnOnUnregistered: false });
mockery.registerMock('@octokit/rest', GHMock);
