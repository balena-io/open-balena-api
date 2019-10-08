import * as Octokit from '@octokit/rest';

import * as Bluebird from 'bluebird';
import gunzip = require('gunzip-maybe');
import * as _ from 'lodash';
import * as request from 'request';
import * as tar from 'tar-stream';
import { captureException } from '../../../platform/errors';

// import * as pkg from '../../../../package.json';

import {
	DEVICE_TYPE_REPO_NAME,
	DEVICE_TYPE_REPO_OWNER,
	DEVICE_TYPE_REPO_REF,
} from '../../config';

interface FetchDeviceTypeOptions {
	owner: string;
	repo: string;
	archive_format?: string;
	ref?: string;
}

interface DTContract {
	slug: string;
	version: string;
	type: string;
	name: string;
}

let cachedDeviceTypes: DTContract[] = [];
let currentHash = '';

export const fetchExternalDeviceTypes = async (
	options: FetchDeviceTypeOptions = {
		owner: DEVICE_TYPE_REPO_OWNER,
		repo: DEVICE_TYPE_REPO_NAME,
		ref: DEVICE_TYPE_REPO_REF,
	},
): Promise<string[]> => {
	const octokit = new Octokit({
		// ToDo: use current version string in UA
		userAgent: `OpenBalenaApi`,
	});
	options.archive_format = 'tarball';
	try {
		const branch = await octokit.repos.getBranch({
			owner: options.owner!,
			repo: options.repo!,
			branch: options.ref!,
		});

		if (branch.data.commit.sha !== currentHash) {
			const archiveLinkResponse: AnyObject = await octokit.repos.getArchiveLink(
				{
					owner: options.owner!,
					repo: options.repo!,
					ref: options.ref!,
					archive_format: 'tarball',
				},
			);

			const archiveUrl = archiveLinkResponse.url;
			const extractor = tar.extract();
			const dtRegex = /.*\/contracts\/hw\.device-type\/.*\/contract\.json/;
			const deviceTypes: DTContract[] = [];

			await new Bluebird(resolve => {
				extractor.on(`entry`, (headers, stream, next) => {
					const chunks: Buffer[] = [];
					if (dtRegex.test(headers.name)) {
						stream.on('end', function() {
							const buf = Buffer.concat(chunks);
							const dtContract = JSON.parse(buf.toString('UTF-8'));
							deviceTypes.push(dtContract);
							next(); // ready for next entry
						});

						stream.on('data', (chunk: Buffer) => {
							chunks.push(chunk);
						});
					} else {
						// skip to next entry immediately
						next();
					}
					stream.resume();
				});

				extractor.on('finish', () => {
					resolve(deviceTypes);
				});

				extractor.on('error', e => {
					captureException(
						e,
						'Failed to extract tar stream from GH contract repositority',
					);
				});

				const gunzipper = gunzip();

				gunzipper.on('error', e => {
					captureException(
						e,
						'Failed to unzip stream from GH contract repositority',
					);
				});

				request
					.get(archiveUrl)
					.pipe(gunzipper)
					.pipe(extractor);
			}).timeout(20 * 1000);

			currentHash = branch.data.commit.sha;
			cachedDeviceTypes = deviceTypes;
		}
	} catch (e) {
		captureException(e, 'Failed to sync device types from GH repository');
	}
	return cachedDeviceTypes.map(({ slug }) => slug);
};
